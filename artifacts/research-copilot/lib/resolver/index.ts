/**
 * lib/resolver/index.ts — Biological Query Resolution Layer (Phase 5.1.5)
 *
 * Entry point: resolveQuery(query) → QueryResolution
 *
 * ── Architecture contract (Step 16) ──────────────────────────────────────────
 * This module is the single entry point for ALL scientific providers:
 *   Current: PubMed, GEO, Sequence Foundation
 *   Future:  Gene Explorer (5.2), Transcript Explorer (5.3), Protein Explorer (5.4),
 *            ENA, SRA, UniProt, AlphaFold, KEGG, Reactome
 *
 * No future provider should implement its own query classification — they
 * consume QueryResolution output instead.
 *
 * ── Deterministic resolution order (Step 3) ──────────────────────────────────
 * Applied in this exact order on every query — never reordered per query:
 *
 *   1. Accession  — pure regex; covers Accession, Assembly, Chromosome,
 *                   Transcript, Protein, Genome (NG_) sub-types
 *   2. Gene       — NCBI Gene ESearch (only attempted if GENE_SYMBOL_RE matches)
 *   3. Organism   — NCBI Taxonomy ESearch
 *   4. Disease    — NCBI MedGen ESearch
 *   5. Unknown    — fallback when confidence < 0.60 at every step
 *
 * Steps 2, 3, and 4 require NCBI API calls and run sequentially (never
 * concurrently) to stay within NCBI's 3 req/s rate limit.
 *
 * ── Synonym normalization (Step 10) ──────────────────────────────────────────
 * Applied first, before any API call. The normalized term is passed to
 * downstream API-based resolvers. normalizedQuery in the output reflects
 * the canonical form (e.g. "TB" → "Tuberculosis" via hardcoded lookup).
 *
 * Synonym normalization NEVER changes queryType (type-independence rule):
 *   "TB" → type="Disease", not "Organism", even though the associated organism
 *   is Mycobacterium tuberculosis.
 *
 * ── Confidence tiers (Step 5) ────────────────────────────────────────────────
 * HIGH   (≥ 0.90): resolvedQuery auto-passed to downstream modules
 * MEDIUM (0.60–0.89): shown to user as suggestion; not auto-applied
 * LOW    (< 0.60): Unknown; no suggestion; originalQuery used unchanged
 *
 * ── Error handling (Step 13) ─────────────────────────────────────────────────
 * Errors are always caught and converted to Unknown with a descriptive note.
 * The resolver never throws — a failed resolution degrades gracefully to Unknown.
 */

import { normalizeSynonyms } from "@/lib/resolver/synonyms";
import { classifyAccession } from "@/lib/resolver/accession";
import { resolveGene } from "@/lib/resolver/gene";
import { resolveOrganism } from "@/lib/resolver/organism";
import { resolveDisease } from "@/lib/resolver/disease";
import { detectOrganismPrefix } from "@/lib/resolver/organism-prefix";
import type { QueryResolution } from "@/types/query-resolution";
import { unknownResolution } from "@/types/query-resolution";

export type { QueryResolution };

// ─── Resolver-level constants ─────────────────────────────────────────────────

/**
 * Gene-symbol character pattern (mirrors gene.ts and genbank/search.ts).
 * Kept local so the resolver index has no coupling to internal gene.ts constants.
 */
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,12}$/;

/**
 * Disease-qualifier vocabulary.
 *
 * When a query BOTH looks like a gene symbol AND contains one of these words,
 * disease resolution is appropriate (e.g. "TP53 mutation", "BRCA1 syndrome").
 * Bare gene-symbol queries without such qualifiers are NOT routed to disease.
 */
const DISEASE_QUALIFIER_RE =
  /\b(mutation|mutant|variant|variants|syndrome|polymorphism|pathogenic|pathogenicity|deficiency|disease|disorder|carcinoma|lymphoma|leukemia|sarcoma|melanoma|glioma|tumor|tumour|cancer|neoplasm|malignancy|deletion|duplication|frameshift|truncation|translocation|rearrangement|amplification|haploinsufficiency)\b/i;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Resolve the biological meaning of a user query.
 *
 * Always returns a QueryResolution — never throws.
 * On any internal error the resolution degrades to Unknown with an error note.
 *
 * @param query  Raw query string as entered by the user.
 */
export async function resolveQuery(query: string): Promise<QueryResolution> {
  const trimmed = query.trim();
  if (!trimmed) return unknownResolution(query);

  try {
    return await _resolveQuery(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...unknownResolution(trimmed),
      notes: `Resolution failed: ${message}. Downstream modules will use the original query.`,
    };
  }
}

// ─── Internal pipeline ────────────────────────────────────────────────────────

async function _resolveQuery(query: string): Promise<QueryResolution> {
  // ── Pre-step: Organism prefix detection (FIX 1–3 — Organism-Aware Gene Ranking Patch) ──
  // Must run BEFORE synonym normalization so that species-qualified gene queries like
  // "mouse CD4", "rat EGFR", "zebrafish Sox2" are handled correctly.
  //
  // When a prefix is detected:
  //   1. The gene symbol (stripped query) is resolved with a taxId-filtered ESearch
  //   2. The detectedOrganismTaxId/Name/strippedGeneQuery fields are set in the result
  //   3. The resolver returns HIGH confidence (0.92) if a matching gene is found
  //   4. Downstream modules (Gene Explorer, Transcript Explorer) use the propagated
  //      organism context — they MUST NOT re-parse the original query (FIX 6)
  //
  // When no prefix is detected OR the stripped query does not resolve to a gene:
  //   → Fall through to the normal synonym-normalization + accession + gene + organism
  //     + disease pipeline (unchanged behaviour for all other queries).
  const orgPrefix = detectOrganismPrefix(query);
  if (orgPrefix) {
    const prefixGeneResult = await resolveGene(orgPrefix.strippedQuery, {
      taxId: orgPrefix.taxId,
      name: orgPrefix.name,
    });
    if (prefixGeneResult && prefixGeneResult.confidence >= 0.60) {
      return {
        originalQuery: query,
        ...prefixGeneResult,
        detectedOrganismTaxId: orgPrefix.taxId,
        detectedOrganismName: orgPrefix.name,
        strippedGeneQuery: orgPrefix.strippedQuery,
      };
    }
    // Gene not found for this organism prefix — fall through to normal pipeline.
    // Use the full original query so the organism resolver can still match "mouse" etc.
  }

  // ── Step 0: Synonym normalization (Step 10) ───────────────────────────────
  // Apply the hardcoded synonym table first. API-based synonym data from MeSH,
  // MedGen, and NCBI Taxonomy is collected within the individual resolvers.
  const {
    normalizedQuery: normalized,
    synonymSource,
    synonyms,
    expanded,
    synonymPreferredType,
  } = normalizeSynonyms(query);

  // The effective query for API lookups (post-synonym-expansion)
  const q = normalized;

  // ── Step 1: Accession (pure regex — no API call) ──────────────────────────
  // Covers: Accession, Assembly, Chromosome, Transcript, Protein, Genome (NG_)
  const accessionResult = classifyAccession(q);
  if (accessionResult) {
    // accessionResult is Omit<QueryResolution, "originalQuery" | "relationships"> —
    // relationships is intentionally absent (no biological relations for bare accessions).
    return {
      originalQuery: query,
      relationships: {},
      ...(expanded ? { synonyms: [normalized, ...synonyms], synonymSource } : {}),
      ...accessionResult,
    };
  }

  // ── Step 2: Gene (NCBI Gene ESearch) ─────────────────────────────────────
  // Extended to handle lowercase and mixed-case gene symbols (e.g. "tp53",
  // "brca1") — queries that look like gene symbols when uppercased are now
  // attempted. This prevents MedGen disease concepts from winning for
  // lowercase gene-symbol queries when the user clearly intends the gene.
  //
  // Priority rule: GENE_SYMBOL_RE must match (case-insensitively for the
  // gate check). Non-symbol queries — multi-word, hyphened, longer than
  // 13 chars — skip the gene step entirely as before.
  //
  // When the query is already all-uppercase it passes as-is (unchanged
  // behaviour). When it is lowercase/mixed-case but matches the pattern when
  // uppercased, we uppercase it so resolveGene()'s internal GENE_SYMBOL_RE
  // guard passes and NCBI ESearch receives the canonical capitalisation.
  // For the lowercase/mixed-case branch a digit is required (matching the
  // heuristic in genbank/search.ts). This keeps gene-lookup opt-in for
  // symbol-shaped words like "mouse", "cancer", or "virus" that have no
  // digit — they are overwhelmingly disease/organism queries and should not
  // consume an extra NCBI Gene API call. Pure-alpha lowercase genes such as
  // "egfr" or "kras" will not be caught here, but their uppercase forms
  // ("EGFR", "KRAS") already pass the first branch unchanged.
  const geneQuery = GENE_SYMBOL_RE.test(q)
    ? q                                                          // already uppercase — unchanged behaviour
    : GENE_SYMBOL_RE.test(q.toUpperCase()) && /\d/.test(q)
    ? q.toUpperCase()                                            // lowercase/mixed gene symbol with digit — normalise
    : null;                                                      // not gene-symbol-shaped, or pure-alpha lowercase — skip

  const geneResult = geneQuery != null ? await resolveGene(geneQuery) : null;
  if (geneResult && geneResult.confidence >= 0.60) {
    const mergedSynonyms = expanded
      ? [...(geneResult.synonyms ?? []), ...synonyms]
      : geneResult.synonyms;
    const mergedSynonymSource = expanded
      ? (synonymSource ?? geneResult.synonymSource)
      : geneResult.synonymSource;
    return {
      originalQuery: query,
      ...geneResult,
      ...(mergedSynonyms && mergedSynonyms.length > 0
        ? { synonyms: mergedSynonyms, synonymSource: mergedSynonymSource }
        : {}),
    };
  }

  // ── Step 3: Organism (NCBI Taxonomy ESearch) ──────────────────────────────
  // Skip if the synonym expansion identified this as a Disease abbreviation.
  // Rationale: disease abbreviations like "COVID" expand to "COVID-19" which NCBI
  // Taxonomy matches as SARS-CoV-2 (a virus organism). Skipping the organism step
  // enforces the type-independence rule — the synonym's intended type governs routing.
  // If the disease step (Step 4) also fails, the resolver falls through to Unknown.
  const skipOrganism = expanded && synonymPreferredType === "Disease";
  const organismResult = skipOrganism ? null : await resolveOrganism(q);
  if (organismResult && organismResult.confidence >= 0.60) {
    const mergedSynonyms = expanded
      ? [...(organismResult.synonyms ?? []), ...synonyms]
      : organismResult.synonyms;
    const mergedSynonymSource = expanded
      ? (synonymSource ?? organismResult.synonymSource)
      : organismResult.synonymSource;
    return {
      originalQuery: query,
      ...organismResult,
      ...(mergedSynonyms && mergedSynonyms.length > 0
        ? { synonyms: mergedSynonyms, synonymSource: mergedSynonymSource }
        : {}),
    };
  }

  // ── Step 4: Disease (NCBI MedGen ESearch) ────────────────────────────────
  //
  // Gate: bare gene-symbol-shaped queries with at least one digit and no
  // disease-qualifier language are blocked from disease resolution.
  //
  // Rationale: MedGen contains variant/polymorphism entries that share gene
  // symbol names (e.g. searching "TP53" surfaces "TP53 polymorphism" as a
  // partial match). If the gene resolver ran but found nothing — due to a
  // transient NCBI error, rate limit, or genuinely absent symbol — returning
  // a spurious Disease resolution is worse than returning Unknown.
  //
  // The digit requirement is intentional: it allows pure-alpha disease nouns
  // ("cancer", "tuberculosis", "diabetes") to still reach this step normally
  // while blocking numeric gene symbols ("tp53", "brca1", "cdkn2a", "nf1").
  // Queries that contain disease-qualifier language ("TP53 mutation",
  // "BRCA1 syndrome") have spaces, so GENE_SYMBOL_RE.test(q.toUpperCase())
  // returns false and the gate does not apply.
  const isBareLikelyGeneSymbol =
    /\d/.test(q) &&
    GENE_SYMBOL_RE.test(q.toUpperCase()) &&
    !DISEASE_QUALIFIER_RE.test(q);

  if (isBareLikelyGeneSymbol) {
    // The query looks like a gene symbol, not a disease concept.
    // Return Unknown so the UI shows a neutral "not resolved" state rather
    // than a misleading Disease resolution.
    return unknownResolution(query);
  }

  const diseaseResult = await resolveDisease(q);
  if (diseaseResult && diseaseResult.confidence >= 0.60) {
    if (expanded) {
      return {
        originalQuery: query,
        ...diseaseResult,
        synonyms: [...synonyms],
        synonymSource,
        notes: `Synonym "${query}" → "${normalized}" (hardcoded fallback). ${diseaseResult.notes ?? ""}`,
      };
    }
    return {
      originalQuery: query,
      ...diseaseResult,
    };
  }

  // ── Step 5: Unknown ───────────────────────────────────────────────────────
  if (expanded) {
    return {
      ...unknownResolution(query),
      normalizedQuery: normalized,
      synonyms,
      synonymSource,
      notes: `Synonym expanded "${query}" → "${normalized}" (${synonymSource}) but no biological entity was identified. Downstream modules will use originalQuery.`,
    };
  }
  return unknownResolution(query);
}
