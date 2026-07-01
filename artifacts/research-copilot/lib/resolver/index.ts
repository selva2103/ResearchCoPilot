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
import type { QueryResolution } from "@/types/query-resolution";
import { unknownResolution } from "@/types/query-resolution";

export type { QueryResolution };

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
  // Only attempted when query matches GENE_SYMBOL_RE — prevents wasting API
  // calls on organism names, disease names, or other non-symbol queries.
  const geneResult = await resolveGene(q);
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
