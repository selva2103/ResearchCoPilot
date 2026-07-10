/**
 * lib/resolver/index.ts — Biological Query Resolution Layer (Phase R)
 *
 * Entry point: resolveQuery(query) → NormalizedQuery
 *
 * Phase R replaces the old sequential early-return pipeline (Accession → Gene →
 * Organism → Disease, first match wins) with a MULTI-ENTITY EXTRACTION +
 * MERGE pipeline: gene, organism, and disease are each independently
 * attempted, then merged into a single NormalizedQuery so context is never
 * silently discarded (e.g. "TP53 breast cancer" now yields both
 * gene.symbol="TP53" and disease.name="Breast Cancer").
 *
 * ── Pipeline ──────────────────────────────────────────────────────────────────
 *   0. Synonym normalization (hardcoded fallback table — unchanged from before).
 *   1. Accession — pure regex, no API call. A distinct entity family from
 *      gene/organism/disease; short-circuits with `protein.accession` set.
 *   2. Explicit organism detection — LOCAL lookup table only (organism-synonyms.ts),
 *      zero API calls. Handles both prefix ("mouse Cd4") and suffix
 *      ("Trp53 Mus musculus", "BRCA2 human") patterns.
 *   3. Gene extraction — resolveGene() against the organism-qualified remainder
 *      when an explicit organism was found; otherwise against the whole query
 *      (bare gene-symbol shape) or an embedded gene-shaped token within a
 *      multi-word query (Bug 1/7 — "TP53 breast cancer").
 *   4. Organism extraction — only via NCBI Taxonomy ESearch when no explicit
 *      local organism was found AND no gene was resolved (preserves the
 *      original call pattern / rate-limit behaviour).
 *   5. Disease extraction — reuses the existing MedGen-based resolveDisease().
 *      Bug 4 collision rule: a bare gene symbol with no additional query
 *      context skips the disease call entirely (no new mandatory NCBI call).
 *      When a gene was found alongside extra context words (e.g. "breast
 *      cancer" in "TP53 breast cancer"), or when no gene/organism was found
 *      at all, resolveDisease() runs exactly as it always has.
 *   6. Confidence — evidence-based (see computeConfidence below), never a
 *      fixed per-query-type constant.
 *
 * Every resolution is logged via logDebug() — see RESOLVER DEBUG LOG in the
 * Phase R spec — capturing entities detected, organism chosen, GeneID
 * resolved, confidence, and the reasoning for the final choice.
 *
 * The resolver never throws — a failed resolution degrades to an "empty"
 * NormalizedQuery (all entity fields null, confidence 0).
 */

import { normalizeSynonyms } from "@/lib/resolver/synonyms";
import { classifyAccession } from "@/lib/resolver/accession";
import { resolveGene } from "@/lib/resolver/gene";
import { resolveOrganism } from "@/lib/resolver/organism";
import { resolveDisease } from "@/lib/resolver/disease";
import {
  detectOrganismPrefix,
  detectOrganismSuffix,
} from "@/lib/resolver/organism-prefix";
import type { CandidateMatch } from "@/types/query-resolution";
import type { CandidateResolution, NormalizedQuery } from "@/types/normalized-query";

export type { NormalizedQuery };

// ─── Local constants ───────────────────────────────────────────────────────────

/** Mirrors gene.ts / genbank/search.ts — uppercase-only bare gene-symbol shape. */
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,12}$/;

/**
 * Broader gene-token pattern used only to spot an embedded gene-symbol-shaped
 * token inside a multi-word query (e.g. "TP53" inside "TP53 breast cancer").
 * Mixed-case allowed (non-human symbols are often sentence-case: Trp53).
 * Guard: must contain at least one uppercase letter or digit so lowercase
 * common words ("breast", "cancer") are never mistaken for gene tokens.
 */
const GENE_TOKEN_RE_BROAD = /^[A-Za-z][A-Za-z0-9]{1,15}$/;

function looksLikeGeneToken(s: string): boolean {
  return GENE_TOKEN_RE_BROAD.test(s) && /[A-Z0-9]/.test(s);
}

function emptyNormalized(rawQuery: string): NormalizedQuery {
  return {
    rawQuery,
    gene: null,
    organism: null,
    disease: null,
    protein: null,
    confidence: 0,
    candidates: null,
    ambiguous: false,
    evidence: [],
  };
}

/** Maps the gene resolver's CandidateMatch[] onto NormalizedQuery's flat CandidateResolution[]. */
function mapCandidates(
  matches: CandidateMatch[] | undefined
): CandidateResolution[] | null {
  if (!matches || matches.length === 0) return null;
  return matches.map((m) => ({
    gene: m.queryType === "Gene" ? { symbol: m.displayName, geneId: m.identifier } : null,
    organism: m.organism ? { name: m.organism, taxId: null } : null,
    confidence: m.confidence,
  }));
}

/**
 * Bug 6 — evidence-based confidence scoring.
 *
 * Never a fixed per-query-type constant. Starts from the average confidence
 * of every entity resolver that produced a result, then adds a small
 * agreement bonus scaling with how many independent entities corroborated
 * each other (e.g. gene + organism both confirmed, or gene + disease context
 * both confirmed) — capped at 0.99.
 */
function computeConfidence(entityConfidences: number[]): number {
  if (entityConfidences.length === 0) return 0.3;
  const avg =
    entityConfidences.reduce((sum, c) => sum + c, 0) / entityConfidences.length;
  const agreementBonus =
    entityConfidences.length > 1 ? 0.03 * (entityConfidences.length - 1) : 0;
  return Math.round(Math.min(0.99, avg + agreementBonus) * 100) / 100;
}

function logDebug(entry: {
  rawQuery: string;
  entitiesDetected: string[];
  organismChosen: string | null;
  geneIdResolved: string | null;
  confidence: number;
  reason: string;
}): void {
  // Developer debug log only — never user-facing. Required for every resolution
  // (RESOLVER DEBUG LOG, Phase R spec).
  // eslint-disable-next-line no-console
  console.log(
    `[resolver] "${entry.rawQuery}" → entities=[${entry.entitiesDetected.join(", ") || "none"}] ` +
      `organism=${entry.organismChosen ?? "none"} geneId=${entry.geneIdResolved ?? "none"} ` +
      `confidence=${entry.confidence} reason="${entry.reason}"`
  );
}

// ─── Main export ────────────────────────────────────────────────────────────────

/**
 * Resolve the biological meaning of a user query into a NormalizedQuery.
 * Always returns a NormalizedQuery — never throws.
 */
export async function resolveQuery(query: string): Promise<NormalizedQuery> {
  const trimmed = query.trim();
  if (!trimmed) {
    logDebug({
      rawQuery: query,
      entitiesDetected: [],
      organismChosen: null,
      geneIdResolved: null,
      confidence: 0,
      reason: "Empty query — nothing to resolve.",
    });
    return emptyNormalized(query);
  }

  try {
    return await _resolveQuery(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logDebug({
      rawQuery: trimmed,
      entitiesDetected: [],
      organismChosen: null,
      geneIdResolved: null,
      confidence: 0,
      reason: `Resolution failed with an error: ${message}. Degraded to empty NormalizedQuery.`,
    });
    return emptyNormalized(trimmed);
  }
}

// ─── Internal pipeline ───────────────────────────────────────────────────────────

async function _resolveQuery(rawQuery: string): Promise<NormalizedQuery> {
  const { normalizedQuery: normalized, expanded, synonymPreferredType } =
    normalizeSynonyms(rawQuery);
  const q = normalized;

  // ── Step 1: Accession (pure regex, no API call) ───────────────────────────
  // A distinct entity family — never merged with gene/organism/disease.
  const accessionResult = classifyAccession(q);
  if (accessionResult) {
    logDebug({
      rawQuery,
      entitiesDetected: ["accession"],
      organismChosen: null,
      geneIdResolved: null,
      confidence: accessionResult.confidence,
      reason: `Accession pattern matched (${accessionResult.resolutionPath ?? "accession-pattern"}) — not a gene/organism/disease query.`,
    });
    return {
      rawQuery,
      gene: null,
      organism: null,
      disease: null,
      protein: { accession: accessionResult.primaryIdentifier ?? q },
      confidence: accessionResult.confidence,
      candidates: null,
      ambiguous: false,
      evidence: [
        {
          source: "synonym",
          matchedValue: q,
          reason:
            accessionResult.notes ??
            "Accession pattern match (regex classification, no API call).",
        },
      ],
    };
  }

  // ── Step 2: Explicit organism detection (local lookup table — Bug 2/3/13) ──
  // Zero API calls: uses organism-synonyms.ts, the single canonical table.
  const prefixMatch = detectOrganismPrefix(q);
  const suffixMatch = !prefixMatch ? detectOrganismSuffix(q) : null;
  const explicitOrganism = prefixMatch
    ? {
        taxId: prefixMatch.taxId,
        name: prefixMatch.name,
        matchedSynonym: prefixMatch.matchedSynonym,
        remainder: prefixMatch.strippedQuery,
      }
    : suffixMatch
    ? {
        taxId: suffixMatch.taxId,
        name: suffixMatch.name,
        matchedSynonym: suffixMatch.matchedSynonym,
        remainder: suffixMatch.strippedQuery,
      }
    : null;

  const evidence: NormalizedQuery["evidence"] = [];
  let gene: NormalizedQuery["gene"] = null;
  let organism: NormalizedQuery["organism"] = null;
  let disease: NormalizedQuery["disease"] = null;
  let candidates: CandidateResolution[] | null = null;
  let ambiguous = false;
  const confidenceParts: number[] = [];
  let contextRemainder: string | null = null;

  // ── Step 3: Gene extraction ────────────────────────────────────────────────
  let geneApiResult: Awaited<ReturnType<typeof resolveGene>> = null;

  if (explicitOrganism) {
    // Species-aware resolution (Bug 2) — search the organism-qualified remainder.
    geneApiResult = await resolveGene(explicitOrganism.remainder, {
      taxId: explicitOrganism.taxId,
      name: explicitOrganism.name,
    });
  } else {
    // CASE-SENSITIVITY PATCH: when q is already all-uppercase (matches
    // GENE_SYMBOL_RE directly), pass it through unchanged as before. When q is
    // mixed-case but shaped like a gene symbol once uppercased (e.g. "Trp53"),
    // preserve its ORIGINAL case rather than uppercasing it — resolveGene's
    // new Step 0a needs the exact case to check it against species-specific
    // symbol conventions (mouse/rat sentence-case vs. human ALL-CAPS) before
    // falling back to a case-insensitive human-first match. Uppercasing here
    // used to destroy that information before resolveGene ever saw it.
    const wholeStringCandidate = GENE_SYMBOL_RE.test(q)
      ? q
      : GENE_SYMBOL_RE.test(q.toUpperCase()) && /\d/.test(q)
      ? q
      : null;

    if (wholeStringCandidate) {
      geneApiResult = await resolveGene(wholeStringCandidate);
    } else {
      // Bug 1/7 — embedded gene-token extraction within a multi-word query
      // (e.g. "TP53" inside "TP53 breast cancer").
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        const idx = tokens.findIndex((t) => looksLikeGeneToken(t));
        if (idx >= 0) {
          const candidateResult = await resolveGene(tokens[idx].toUpperCase());
          if (candidateResult) {
            geneApiResult = candidateResult;
            contextRemainder = tokens.filter((_, i) => i !== idx).join(" ");
          }
        }
      }
    }
  }

  if (geneApiResult) {
    gene = {
      symbol: geneApiResult.normalizedQuery,
      geneId: geneApiResult.primaryIdentifier ?? null,
      organismMatched: geneApiResult.organism ?? null,
    };
    confidenceParts.push(geneApiResult.confidence);
    ambiguous = ambiguous || Boolean(geneApiResult.ambiguityDetected);
    candidates = mapCandidates(geneApiResult.candidateMatches) ?? candidates;
    evidence.push({
      source: "ncbi-gene",
      matchedValue: gene.symbol,
      reason: `Gene symbol confirmed via NCBI Gene (${geneApiResult.resolutionPath ?? "ncbi-gene"}), organism=${gene.organismMatched ?? "unknown"}.`,
    });
  }

  // ── Step 4: Organism extraction ────────────────────────────────────────────
  if (explicitOrganism) {
    organism = {
      name: explicitOrganism.name,
      taxId: String(explicitOrganism.taxId),
      matchedSynonym: explicitOrganism.matchedSynonym,
    };
    confidenceParts.push(0.95); // deterministic lookup-table match — high trust, no API call
    evidence.push({
      source: "synonym",
      matchedValue: explicitOrganism.matchedSynonym,
      reason: `Organism synonym "${explicitOrganism.matchedSynonym}" resolved to ${explicitOrganism.name} (taxId ${explicitOrganism.taxId}) via lookup table.`,
    });
  } else if (!gene) {
    // Preserve original rate-limit behaviour: NCBI Taxonomy is only called
    // when no gene was already resolved and no local organism synonym matched.
    const skipOrganism = expanded && synonymPreferredType === "Disease";
    if (!skipOrganism) {
      const organismApiResult = await resolveOrganism(q);
      if (organismApiResult && organismApiResult.confidence >= 0.6) {
        organism = {
          name: organismApiResult.normalizedQuery,
          taxId: organismApiResult.taxonomyId ?? null,
          matchedSynonym: null,
        };
        confidenceParts.push(organismApiResult.confidence);
        evidence.push({
          source: "taxonomy",
          matchedValue: organismApiResult.normalizedQuery,
          reason: `NCBI Taxonomy match (${organismApiResult.resolutionPath ?? "ncbi-taxonomy"}).`,
        });
      }
    }
  } else if (geneApiResult?.taxonomyId) {
    // Enrichment only (Bug 1 — never discard information already known):
    // the gene resolver already confirmed an organism; surface it on
    // NormalizedQuery.organism too, without an extra API call or confidence
    // contribution (it's the same evidence as the gene match, not new agreement).
    organism = {
      name: geneApiResult.organism ?? gene?.organismMatched ?? "",
      taxId: geneApiResult.taxonomyId,
      matchedSynonym: null,
    };
  }

  // ── Step 5: Disease extraction (Bug 4/7 — reuse existing MedGen classifier) ─
  // Bare gene symbol with no additional context: skip disease entirely (no new
  // mandatory NCBI call). Gene + extra context, or no gene/organism at all:
  // call resolveDisease() exactly as the pipeline already does today.
  const bareGeneNoContext = Boolean(gene) && !contextRemainder && !explicitOrganism;
  if (!bareGeneNoContext) {
    let diseaseQuery: string | null = null;
    if (gene && contextRemainder) {
      diseaseQuery = contextRemainder;
    } else if (!gene && !organism) {
      const isBareLikelyGeneSymbol =
        /\d/.test(q) && GENE_SYMBOL_RE.test(q.toUpperCase());
      if (!isBareLikelyGeneSymbol) diseaseQuery = q;
    }

    if (diseaseQuery) {
      const diseaseApiResult = await resolveDisease(diseaseQuery);
      if (diseaseApiResult && diseaseApiResult.confidence >= 0.6) {
        disease = { name: diseaseApiResult.normalizedQuery };
        confidenceParts.push(diseaseApiResult.confidence);
        evidence.push({
          source: "medgen",
          matchedValue: disease.name,
          reason: `MedGen classified "${diseaseQuery}" as a disease entity (${diseaseApiResult.resolutionPath ?? "medgen"})${gene ? ", alongside the recognized gene symbol" : ""}.`,
        });
      }
    }
  }

  // ── Step 6: Confidence + debug log ─────────────────────────────────────────
  const confidence = computeConfidence(confidenceParts);

  const reason =
    gene && disease
      ? `Gene "${gene.symbol}" and disease "${disease.name}" both confirmed — context preserved.`
      : gene && bareGeneNoContext
      ? `Gene "${gene.symbol}" preferred over any disease interpretation: no disease-specific context found beyond the bare symbol.`
      : gene
      ? `Gene "${gene.symbol}" resolved${organism ? ` for organism ${organism.name}` : ""}; no disease context confirmed.`
      : organism && !disease
      ? `Organism "${organism.name}" resolved; no gene symbol present in the query.`
      : disease
      ? `Disease "${disease.name}" resolved via MedGen; no gene-symbol collision detected.`
      : "No biological entity could be confirmed for this query.";

  logDebug({
    rawQuery,
    entitiesDetected: [gene && "gene", organism && "organism", disease && "disease"].filter(
      (v): v is string => Boolean(v)
    ),
    organismChosen: organism?.name ?? null,
    geneIdResolved: gene?.geneId ?? null,
    confidence,
    reason,
  });

  return {
    rawQuery,
    gene,
    organism,
    disease,
    protein: null,
    confidence,
    candidates,
    ambiguous,
    evidence,
  };
}
