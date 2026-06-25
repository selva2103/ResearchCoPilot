/**
 * PubMed integration — public API
 *
 * Full pipeline:
 *
 *   query
 *     ↓  ESearch  (search.ts)           → throws on failure
 *   pmids[]
 *     ↓  ESummary + EFetch in parallel  (summary.ts / abstract.ts)
 *   summaryData + abstractData
 *     ↓  parser  (parser.ts)
 *   Paper[]  wrapped in ModuleResult<Paper>
 *
 * ALL future scientific modules MUST return ModuleResult<T>.
 * See types/module-result.ts for the full interface and status semantics.
 * Future modules to implement: GenBank, ENA, SRA, UniProt, KEGG, Reactome, PDB, AlphaFold.
 *
 * TODO: Europe PMC    — supplement with full-text search results
 * TODO: GEO           — link relevant expression datasets to papers
 * TODO: SRA           — link raw sequencing datasets
 * TODO: ArrayExpress  — link transcriptomics experiments
 * TODO: TCGA          — link cancer genomics datasets
 * TODO: AI summarization — use OpenAI to distill abstracts into plain-language summaries
 * TODO: Keyword extraction — cluster MeSH terms for the Research Landscape section
 * TODO: Citation counts   — integrate iCite API (https://icite.od.nih.gov/api)
 */

import type { Paper } from "@/types/paper";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { searchPubMedIds } from "./search";
import { fetchPaperSummaries } from "./summary";
import { fetchPaperAbstracts } from "./abstract";
import { parsePubMedResults } from "./parser";

/**
 * Search PubMed for papers matching `query` and return up to 10 Paper objects
 * wrapped in a ModuleResult<Paper>.
 *
 * Pipeline: ESearch → ESummary + EFetch (parallel) → parse → ModuleResult<Paper>
 *
 * Status mapping — exact per-stage conditions that trigger each value:
 *
 *   "error"   — ESearch fails (network error, HTTP error, rate-limit after retries exhausted);
 *               OR ESearch succeeds but ESummary fails (no usable paper metadata available).
 *               data is always [] when status is "error".
 *
 *   "empty"   — ESearch succeeds but returns 0 PMIDs (genuinely no matching papers found);
 *               OR ESummary returns data but none of the articles could be parsed into Papers.
 *
 *   "partial" — ESearch + ESummary succeed (papers have titles/authors/journals/years),
 *               but EFetch fails (papers lack abstract, DOI, MeSH terms, publication types).
 *               data.length > 0; useful partial results exist. Future modules should
 *               follow this pattern: "partial" requires usable data AND at least one failure.
 *
 *   "success" — All three stages (ESearch, ESummary, EFetch) succeed and data.length > 0.
 */
export async function searchPubMed(query: string): Promise<ModuleResult<Paper>> {
  const startedAt = performance.now();

  // ── Stage 1: ESearch → PMIDs ─────────────────────────────────────────────
  // searchPubMedIds throws on HTTP error or network failure.
  // If this stage fails → status "error" (no usable data at all).
  let pmids: string[];
  try {
    pmids = await searchPubMedIds(query);
  } catch (err) {
    return buildModuleResult({
      module: "pubmed",
      status: "error",
      data: [],
      error: toModuleError("ESEARCH_FAILED", err),
      startedAt,
    });
  }

  if (pmids.length === 0) {
    // ESearch succeeded but found 0 matching PMIDs → genuinely empty result set
    return buildModuleResult({
      module: "pubmed",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  // ── Stage 2: ESummary + EFetch in parallel ────────────────────────────────
  // allSettled tracks per-stage failure independently without throwing.
  // ESummary provides metadata: title, authors, journal, year.
  // EFetch provides extended data: abstract, DOI, MeSH terms, publication types.
  const [summarySettled, abstractSettled] = await Promise.allSettled([
    fetchPaperSummaries(pmids),
    fetchPaperAbstracts(pmids),
  ]);

  const esummaryFailed = summarySettled.status === "rejected";
  const efetchFailed = abstractSettled.status === "rejected";

  if (esummaryFailed) {
    // ESearch succeeded (we have PMIDs), but ESummary failed.
    // Without ESummary metadata, parsePubMedResults returns [] regardless of EFetch.
    // No usable data → status "error".
    return buildModuleResult({
      module: "pubmed",
      status: "error",
      data: [],
      error: toModuleError("ESUMMARY_FAILED", summarySettled.reason),
      startedAt,
    });
  }

  const summaryData = summarySettled.value;
  const abstractData = efetchFailed ? {} : abstractSettled.value;
  const papers = parsePubMedResults(summaryData, abstractData);

  if (efetchFailed) {
    // ESearch + ESummary succeeded, EFetch failed.
    // parsePubMedResults still produces papers from ESummary data, but they lack
    // the extended EFetch fields (abstract, DOI, MeSH terms, publication types).
    // "partial" if papers were produced; "empty" if ESummary had no parseable articles.
    return buildModuleResult({
      module: "pubmed",
      status: papers.length > 0 ? "partial" : "empty",
      data: papers,
      error: toModuleError("EFETCH_FAILED", abstractSettled.reason),
      startedAt,
    });
  }

  // All three stages succeeded
  return buildModuleResult({
    module: "pubmed",
    status: papers.length > 0 ? "success" : "empty",
    data: papers,
    error: null,
    startedAt,
  });
}

// Re-export types for consumers that want fine-grained access
export type { Paper } from "@/types/paper";
export { searchPubMedIds } from "./search";
export { fetchPaperSummaries } from "./summary";
export { fetchPaperAbstracts } from "./abstract";
export { extractMeshTerms } from "./mesh";
export { parsePubMedResults } from "./parser";
