/**
 * GEO integration — public API
 *
 * Full pipeline:
 *
 *   query
 *     ↓  ESearch (db=gds)  →  searchGeoIds()      — throws on failure
 *   { uids[], totalCount }
 *     ↓  ESummary (db=gds) →  fetchGeoSummaries()  — throws on failure
 *   raw GEO records
 *     ↓  parseGeoResults()                         — GSE-only filter + field normalisation
 *   Dataset[]  wrapped in ModuleResult<Dataset>
 *
 * ALL future scientific modules MUST return ModuleResult<T>.
 * See types/module-result.ts for the full interface and status semantics.
 * Future modules to implement: GenBank, ENA, SRA, UniProt, KEGG, Reactome, PDB, AlphaFold.
 *
 * Pipeline is 2 steps (ESearch → ESummary) — there is NO GEO EFetch equivalent.
 * Do not add a third step to mirror PubMed's 3-step shape.
 *
 * TODO: SRA integration          — NCBI SRA for raw sequencing runs linked to GSE
 * TODO: ArrayExpress integration — EBI ArrayExpress for European transcriptomics datasets
 * TODO: TCGA integration         — NCI GDC portal for cancer genomics datasets
 * TODO: Europe PMC               — full-text search to find datasets cited in papers
 * TODO: AI reasoning layer       — use OpenAI to rank/summarise datasets for the query
 * TODO: Keyword extraction       — cluster GEO gdstype tags for experiment-type classification
 * TODO: RAG support              — vector-embed dataset summaries for semantic retrieval
 * TODO: ELink integration        — link GSE → PubMed articles for citation context
 */

import type { Dataset } from "@/types/dataset";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { searchGeoIds } from "./search";
import { fetchGeoSummaries } from "./summary";
import { parseGeoResults } from "./parser";

/**
 * Search GEO for datasets matching `query` and return up to 10 Dataset objects
 * wrapped in a ModuleResult<Dataset>.
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
 *               Note: if NCBI returns records but the GSE filter drops all of them,
 *               the comment below will distinguish this from a true NCBI zero-result.
 *
 *   "partial" — NOT achievable in GEO's current 2-step pipeline. Both ESearch and ESummary
 *               are single batch calls that either fully succeed or fully fail as a unit.
 *               A future GEO implementation making per-record API calls (e.g. per-GSE
 *               supplementary metadata via GEO web services) could produce "partial" status
 *               when some records succeed and others fail. When that happens, follow the
 *               PubMed EFetch pattern: set status "partial", include successfully retrieved
 *               records in data[], and populate error with a description of the partial failure.
 *               TODO: revisit "partial" when per-record supplementary metadata is added.
 *
 *   "success" — Both stages (GEO ESearch, GEO ESummary) succeed and data.length > 0.
 */
export async function searchGeoDatasets(query: string): Promise<ModuleResult<Dataset>> {
  const startedAt = performance.now();

  // ── Stage 1: GEO ESearch → UIDs ──────────────────────────────────────────
  // searchGeoIds throws on HTTP error or network failure.
  // Returns both the UID list and the raw NCBI total count for diagnostics.
  // If this stage fails → status "error" (no usable data at all).
  let uids: string[];
  let totalCount: number;
  try {
    const searchResult = await searchGeoIds(query);
    uids = searchResult.uids;
    totalCount = searchResult.totalCount;
  } catch (err) {
    return buildModuleResult({
      module: "geo",
      status: "error",
      data: [],
      error: toModuleError("GEO_ESEARCH_FAILED", err),
      startedAt,
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
    // totalCount comes from ESearch; datasets.length may be < uids.length
    // if some UIDs were non-GSE types (GDS/GPL/GSM) that were filtered out.
    datasets = parseGeoResults(summaryData);
  } catch (err) {
    return buildModuleResult({
      module: "geo",
      status: "error",
      data: [],
      error: toModuleError("GEO_ESUMMARY_FAILED", err),
      startedAt,
    });
  }

  // Both stages succeeded. datasets may be < uids.length if the GSE filter dropped
  // some non-GSE records — this is expected and counted as "empty" or "success" based
  // on final data.length, not uids.length.
  // Suppress totalCount lint warning — it's retained for future structured logging.
  void totalCount;

  return buildModuleResult({
    module: "geo",
    status: datasets.length > 0 ? "success" : "empty",
    data: datasets,
    error: null,
    startedAt,
  });
}

// Re-export types and sub-functions for consumers that want fine-grained access
export type { Dataset, GeoDataset } from "@/types/dataset";
export { searchGeoIds } from "./search";
export { fetchGeoSummaries } from "./summary";
export { parseGeoResults } from "./parser";
