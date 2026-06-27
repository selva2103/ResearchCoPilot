/**
 * GEO integration — public API
 *
 * Full pipeline:
 *
 *   query + limit + offset
 *     ↓  ESearch (db=gds)  →  searchGeoIds()      — throws on failure
 *   { uids[], totalCount }
 *     ↓  ESummary (db=gds) →  fetchGeoSummaries()  — throws on failure
 *   raw GEO records
 *     ↓  parseGeoResults()                         — GSE-only filter + field normalisation
 *   Dataset[]  wrapped in ModuleResult<Dataset>  (with full pagination metadata)
 *
 * ALL future scientific modules MUST return ModuleResult<T>.
 * See types/module-result.ts for the full interface and status semantics.
 * Future modules to implement: GenBank, ENA, SRA, UniProt, KEGG, Reactome, PDB, AlphaFold.
 *
 * Pipeline is 2 steps (ESearch → ESummary) — there is NO GEO EFetch equivalent.
 * Do not add a third step to mirror PubMed's 3-step shape.
 *
 * NCBI ceiling: retstart + retmax ≤ 9,999 (practical ESearch ceiling for history-less queries).
 * When offset + limit > 9,999: cap the actual fetch, set hitUpstreamLimit=true in ModuleResult.
 * WebEnv/QueryKey bypass is explicitly deferred to a future phase.
 *
 * Rate limit: GEO costs 2 upstream calls per page (ESearch + ESummary), vs PubMed's 3.
 * This difference matters when scheduling concurrent Load More requests — they share the
 * same 3 req/s NCBI rate limit. Never run PubMed and GEO Load More simultaneously.
 *
 * TODO: SRA integration          — NCBI SRA for raw sequencing runs linked to GSE
 * TODO: ArrayExpress integration — EBI ArrayExpress for European transcriptomics datasets
 * TODO: TCGA integration         — NCI GDC portal for cancer genomics datasets
 * TODO: Europe PMC               — full-text search to find datasets cited in papers
 * TODO: AI reasoning layer       — use OpenAI to rank/summarise datasets for the query
 * TODO: Keyword extraction       — cluster GEO gdstype tags for experiment-type classification
 * TODO: RAG support              — vector-embed dataset summaries for semantic retrieval
 * TODO: ELink integration        — link GSE → PubMed articles for citation context
 * TODO: WebEnv/QueryKey          — bypass NCBI ESearch ceiling for very large result sets
 */

import type { Dataset } from "@/types/dataset";
import type { ModuleResult, ExploreOptions } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { searchGeoIds } from "./search";
import { fetchGeoSummaries } from "./summary";
import { parseGeoResults } from "./parser";

/**
 * NCBI ESearch practical ceiling for history-less (non-WebEnv) queries.
 * Shared with PubMed — both use the same NCBI ESearch endpoint with the same ceiling.
 * See lib/pubmed/index.ts for full documentation of this constant.
 */
const NCBI_ESEARCH_CEILING = 9999;

/**
 * Search GEO for datasets matching `query` and return Dataset objects wrapped in ModuleResult.
 *
 * Accepts ExploreOptions for pagination: limit (default 10) and offset (default 0).
 * Backward compatible — callers that pass only `query` get limit=10, offset=0.
 *
 * Pipeline: GEO ESearch (db=gds) → GEO ESummary (db=gds) → parse (GSE filter) → ModuleResult<Dataset>
 *
 * Status mapping — exact per-stage conditions that trigger each value:
 *
 *   "error"   — GEO ESearch fails (network error, HTTP error, rate-limit after retries);
 *               OR GEO ESearch succeeds but GEO ESummary fails (no usable dataset metadata).
 *               data is always [] when status is "error".
 *
 *   "empty"   — GEO ESearch succeeds but returns 0 UIDs (genuinely no matching datasets);
 *               OR ESummary returns data but no parseable GSE Dataset objects were produced
 *               (e.g. all records lacked a recognised accession, or were non-GSE entry types).
 *
 *   "partial" — NOT achievable in GEO's current 2-step pipeline. Both ESearch and ESummary
 *               are single batch calls that either fully succeed or fully fail as a unit.
 *               A future GEO implementation making per-record API calls could produce "partial".
 *               TODO: revisit "partial" when per-record supplementary metadata is added.
 *
 *   "success" — Both stages (GEO ESearch, GEO ESummary) succeed and data.length > 0.
 *
 * Pagination semantics: same as PubMed — see lib/pubmed/index.ts for full documentation.
 * Key difference: GEO's GSE-only parser filter may produce data.length < uids.length,
 * which can cause returnedCount to undercount actual NCBI results. hasMore is computed from
 * the NCBI totalCount (not filtered data.length) to avoid prematurely terminating pagination.
 */
export async function searchGeoDatasets(
  query: string,
  options: ExploreOptions = {}
): Promise<ModuleResult<Dataset>> {
  const startedAt = performance.now();
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;

  // ── Ceiling detection ─────────────────────────────────────────────────────
  const wouldExceedCeiling = offset + limit > NCBI_ESEARCH_CEILING;
  const actualLimit = wouldExceedCeiling
    ? Math.max(0, NCBI_ESEARCH_CEILING - offset)
    : limit;

  if (actualLimit <= 0) {
    return buildModuleResult({
      module: "geo",
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount: undefined,
      pageSize: limit,
      offset,
      hasMore: false,
      nextOffset: undefined,
      currentPage: Math.floor(offset / limit) + 1,
      hitUpstreamLimit: true,
    });
  }

  // ── Stage 1: GEO ESearch → UIDs ──────────────────────────────────────────
  // searchGeoIds throws on HTTP error or network failure.
  // Returns both the UID list and the raw NCBI total count for diagnostics.
  // If this stage fails → status "error" (no usable data at all).
  let uids: string[];
  let totalCount: number;
  try {
    const searchResult = await searchGeoIds(query, actualLimit, offset);
    uids = searchResult.uids;
    totalCount = searchResult.totalCount;
  } catch (err) {
    return buildModuleResult({
      module: "geo",
      status: "error",
      data: [],
      error: toModuleError("GEO_ESEARCH_FAILED", err),
      startedAt,
      pageSize: limit,
      offset,
    });
  }

  if (uids.length === 0) {
    // GEO ESearch succeeded but found 0 matching dataset UIDs → genuinely empty.
    // totalCount === 0 here confirms NCBI itself found nothing, not a filter drop.
    return buildModuleResult({
      module: "geo",
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

  // ── Stage 2: GEO ESummary → dataset metadata ─────────────────────────────
  // fetchGeoSummaries throws on HTTP error or network failure.
  // If this stage fails → status "error": we have UIDs but no metadata to return.
  // (Unlike PubMed's ESummary+EFetch, there is no fallback representation from UIDs alone.)
  let datasets: Dataset[];
  try {
    const summaryData = await fetchGeoSummaries(uids);
    // parseGeoResults filters to GSE-only and normalises all fields.
    // datasets.length may be ≤ uids.length if some UIDs were non-GSE types (GDS/GPL/GSM).
    datasets = parseGeoResults(summaryData);
  } catch (err) {
    return buildModuleResult({
      module: "geo",
      status: "error",
      data: [],
      error: toModuleError("GEO_ESUMMARY_FAILED", err),
      startedAt,
      totalCount,
      pageSize: limit,
      offset,
    });
  }

  // ── Compute pagination metadata ───────────────────────────────────────────
  // hasMore is computed from NCBI's totalCount (not filtered datasets.length)
  // because the GSE filter may drop some records, which would cause hasMore
  // to go false prematurely if we used datasets.length as the advance amount.
  // We use uids.length (what NCBI returned) as the page advance amount instead.
  const pageAdvance = uids.length; // how many UIDs NCBI returned (before GSE filter)
  const genuinelyExhausted = offset + pageAdvance >= totalCount;
  const hasMore = !wouldExceedCeiling && !genuinelyExhausted;
  const nextOffset = hasMore ? offset + pageAdvance : undefined;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);

  return buildModuleResult({
    module: "geo",
    status: datasets.length > 0 ? "success" : "empty",
    data: datasets,
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

// Re-export types and sub-functions for consumers that want fine-grained access
export type { Dataset, GeoDataset } from "@/types/dataset";
export { searchGeoIds } from "./search";
export { fetchGeoSummaries } from "./summary";
export { parseGeoResults } from "./parser";
