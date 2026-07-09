/**
 * types/normalized-query.ts — Phase R canonical resolver output.
 *
 * Replaces QueryResolution as the resolver's public output type (Phase R,
 * Design Decision 1). QueryResolution (types/query-resolution.ts) remains in
 * use internally by the individual entity extractors (lib/resolver/gene.ts,
 * organism.ts, disease.ts, accession.ts) as their working return shape, but
 * resolveQuery() itself now returns NormalizedQuery.
 *
 * ARCHITECTURE NOTE — who consumes NormalizedQuery:
 * Only app/api/analyze/route.ts (the orchestrator) consumes the full
 * NormalizedQuery object directly. Gene Explorer, Transcript Explorer, and
 * Protein Explorer do NOT accept NormalizedQuery as input — the orchestrator
 * derives the plain identifiers/arguments they already accept today.
 */

export interface CandidateResolution {
  gene: { symbol: string; geneId: string | null } | null;
  organism: { name: string; taxId: string | null } | null;
  confidence: number;
}

export interface NormalizedQuery {
  /** Original user input, always preserved unmodified (Bug 8). */
  rawQuery: string;

  gene: {
    symbol: string;
    /** NCBI GeneID — the stable key. Null when a gene was recognized but not confirmed via NCBI. */
    geneId: string | null;
    /** Which organism this symbol was resolved for. */
    organismMatched: string | null;
  } | null;

  organism: {
    /** e.g. "Mus musculus" */
    name: string;
    taxId: string | null;
    /** e.g. "mouse" -> "Mus musculus" */
    matchedSynonym: string | null;
  } | null;

  disease: {
    name: string;
  } | null;

  protein: {
    accession: string;
  } | null;

  /** Derived from entity agreement — see computeConfidence() in lib/resolver/index.ts. */
  confidence: number;

  /** Flat alternatives, never nested NormalizedQuery. Null when not ambiguous. */
  candidates: CandidateResolution[] | null;

  ambiguous: boolean;

  /** Records WHY each part of the resolution was made, for debugging. */
  evidence: {
    source: "ncbi-gene" | "medgen" | "taxonomy" | "synonym";
    matchedValue: string;
    reason: string;
  }[];
}
