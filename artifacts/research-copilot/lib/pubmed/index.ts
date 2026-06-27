/**
 * PubMed integration — public API
 *
 * Full pipeline:
 *
 *   query + limit + offset
 *     ↓  ESearch  (search.ts)           → throws on failure
 *   { pmids[], totalCount }
 *     ↓  ESummary + EFetch in parallel  (summary.ts / abstract.ts)
 *   summaryData + abstractData
 *     ↓  parser  (parser.ts)
 *   Paper[]  wrapped in ModuleResult<Paper>  (with full pagination metadata)
 *
 * ALL future scientific modules MUST return ModuleResult<T>.
 * See types/module-result.ts for the full interface and status semantics.
 * Future modules to implement: GenBank, ENA, SRA, UniProt, KEGG, Reactome, PDB, AlphaFold.
 *
 * NCBI ceiling: retstart + retmax ≤ 9,999 (practical ESearch ceiling for history-less queries).
 * When offset + limit > 9,999: cap the actual fetch, set hitUpstreamLimit=true.
 * WebEnv/QueryKey bypass is explicitly deferred to a future phase.
 *
 * Rate limit: PubMed costs 3 upstream calls per page (ESearch, ESummary, EFetch in parallel).
 * GEO costs 2 upstream calls per page (ESearch, ESummary). Account for this when scheduling
 * concurrent Load More requests — they share the same 3 req/s NCBI rate limit.
 *
 * TODO: Europe PMC    — supplement with full-text search results
 * TODO: GEO           — link relevant expression datasets to papers
 * TODO: SRA           — link raw sequencing datasets
 * TODO: ArrayExpress  — link transcriptomics experiments
 * TODO: TCGA          — link cancer genomics datasets
 * TODO: AI summarization — use OpenAI to distill abstracts into plain-language summaries
 * TODO: Keyword extraction — cluster MeSH terms for the Research Landscape section
 * TODO: Citation counts   — integrate iCite API (https://icite.od.nih.gov/api)
 * TODO: WebEnv/QueryKey  — bypass NCBI ESearch ceiling for very large result sets
 */

import type { Paper } from "@/types/paper";
import type { ModuleResult, ExploreOptions } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { searchPubMedIds } from "./search";
import { fetchPaperSummaries } from "./summary";
import { fetchPaperAbstracts } from "./abstract";
import { parsePubMedResults } from "./parser";

/**
 * NCBI ESearch practical ceiling for history-less (non-WebEnv) queries.
 *
 * retstart + retmax must not exceed this value. For queries at or near this limit,
 * we cap the actual fetch to the available window and set hitUpstreamLimit=true in
 * the returned ModuleResult. This is NOT a bug — it is a known NCBI API limitation.
 *
 * The UI must surface hitUpstreamLimit=true differently from genuine exhaustion:
 *   "Showing the first N of totalCount results — narrow your search for more specific results."
 *
 * Deferred: NCBI WebEnv/QueryKey can paginate beyond this ceiling.
 * When implemented: set this constant to Infinity (or remove the check) for WebEnv queries.
 */
const NCBI_ESEARCH_CEILING = 9999;

/**
 * Search PubMed for papers matching `query` and return Paper objects wrapped in ModuleResult.
 *
 * Accepts ExploreOptions for pagination: limit (default 10) and offset (default 0).
 * Backward compatible — callers that pass only `query` get limit=10, offset=0.
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
 *               data.length > 0; useful partial results exist.
 *
 *   "success" — All three stages (ESearch, ESummary, EFetch) succeed and data.length > 0.
 *
 * Pagination semantics:
 *   - hasMore=true  → more records exist beyond this page; nextOffset is set.
 *   - hasMore=false, hitUpstreamLimit=false → results genuinely exhausted.
 *   - hasMore=false, hitUpstreamLimit=true  → ceiling hit; more records exist but
 *     cannot be fetched via retstart/retmax. UI must surface this with a specific message.
 */
export async function searchPubMed(
  query: string,
  options: ExploreOptions = {}
): Promise<ModuleResult<Paper>> {
  const startedAt = performance.now();
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;

  // ── Ceiling detection ─────────────────────────────────────────────────────
  // If this page would push past the NCBI ESearch ceiling, cap what we actually request.
  // We set hitUpstreamLimit=true so the UI can display the correct end-state message.
  const wouldExceedCeiling = offset + limit > NCBI_ESEARCH_CEILING;
  const actualLimit = wouldExceedCeiling
    ? Math.max(0, NCBI_ESEARCH_CEILING - offset)
    : limit;

  // If offset is already at or past the ceiling, there is nothing to fetch.
  if (actualLimit <= 0) {
    return buildModuleResult({
      module: "pubmed",
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount: undefined, // unknown without fetching; caller should use cached totalCount
      pageSize: limit,
      offset,
      hasMore: false,
      nextOffset: undefined,
      currentPage: Math.floor(offset / limit) + 1,
      hitUpstreamLimit: true,
    });
  }

  // ── Stage 1: ESearch → PMIDs ─────────────────────────────────────────────
  // searchPubMedIds throws on HTTP error or network failure.
  // If this stage fails → status "error" (no usable data at all).
  let pmids: string[];
  let totalCount: number;
  try {
    const result = await searchPubMedIds(query, actualLimit, offset);
    pmids = result.pmids;
    totalCount = result.totalCount;
  } catch (err) {
    return buildModuleResult({
      module: "pubmed",
      status: "error",
      data: [],
      error: toModuleError("ESEARCH_FAILED", err),
      startedAt,
      pageSize: limit,
      offset,
    });
  }

  if (pmids.length === 0) {
    // ESearch succeeded but found 0 matching PMIDs → genuinely empty result set.
    return buildModuleResult({
      module: "pubmed",
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount,
      pageSize: limit,
      offset,
      hasMore: false,
      nextOffset: undefined,
      currentPage: Math.floor(offset / limit) + 1,
      totalPages: Math.ceil(totalCount / limit) || 0,
      hitUpstreamLimit: wouldExceedCeiling,
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
      totalCount,
      pageSize: limit,
      offset,
    });
  }

  const summaryData = summarySettled.value;
  const abstractData = efetchFailed ? {} : abstractSettled.value;
  const papers = parsePubMedResults(summaryData, abstractData);

  // ── Compute pagination metadata ───────────────────────────────────────────
  // hasMore = there are more records upstream beyond this page.
  // nextOffset = offset + records returned on this page (may be < limit on final page).
  const returnedCount = papers.length;
  const genuinelyExhausted = offset + returnedCount >= totalCount;
  const hasMore = !wouldExceedCeiling && !genuinelyExhausted;
  const nextOffset = hasMore ? offset + returnedCount : undefined;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);

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
      totalCount,
      pageSize: limit,
      offset,
      hasMore,
      nextOffset,
      currentPage,
      totalPages,
      hitUpstreamLimit: wouldExceedCeiling,
    });
  }

  // All three stages succeeded
  return buildModuleResult({
    module: "pubmed",
    status: papers.length > 0 ? "success" : "empty",
    data: papers,
    error: null,
    startedAt,
    totalCount,
    pageSize: limit,
    offset,
    hasMore,
    nextOffset,
    currentPage,
    totalPages,
    hitUpstreamLimit: wouldExceedCeiling || undefined,
  });
}

// Re-export types for consumers that want fine-grained access
export type { Paper } from "@/types/paper";
export { searchPubMedIds } from "./search";
export { fetchPaperSummaries } from "./summary";
export { fetchPaperAbstracts } from "./abstract";
export { extractMeshTerms } from "./mesh";
export { parsePubMedResults } from "./parser";
