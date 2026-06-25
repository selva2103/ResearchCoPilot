/**
 * GEO integration — public API
 *
 * Full pipeline:
 *
 *   query
 *     ↓  ESearch (db=gds)  →  searchGeoIds()       — throws on failure
 *   uids[]
 *     ↓  ESummary (db=gds) →  fetchGeoSummaries()   — throws on failure
 *   raw GEO records
 *     ↓  parseGeoResults()
 *   Dataset[]  wrapped in ModuleResult<Dataset>
 *
 * ALL future scientific modules MUST return ModuleResult<T>.
 * See types/module-result.ts for the full interface and status semantics.
 * Future modules to implement: GenBank, ENA, SRA, UniProt, KEGG, Reactome, PDB, AlphaFold.
 *
 * TODO: SRA integration          — NCBI SRA for raw sequencing runs linked to GSE
 * TODO: ArrayExpress integration — EBI ArrayExpress for European transcriptomics datasets
 * TODO: TCGA integration         — NCI GDC portal for cancer genomics datasets
 * TODO: Europe PMC               — full-text search to find datasets cited in papers
 * TODO: AI reasoning layer       — use OpenAI to rank/summarise datasets for the query
 * TODO: Keyword extraction       — cluster GEO metadata tags for topic classification
 * TODO: RAG support              — vector-embed dataset summaries for semantic retrieval
 * TODO: Vector embeddings        — store Dataset embeddings for similarity search
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
 * Pipeline: GEO ESearch (db=gds) → GEO ESummary (db=gds) → parse → ModuleResult<Dataset>
 *
 * Status mapping — exact per-stage conditions that trigger each value:
 *
 *   "error"   — GEO ESearch fails (network error, HTTP error, rate-limit after retries);
 *               OR GEO ESearch succeeds but GEO ESummary fails (no usable dataset metadata).
 *               data is always [] when status is "error".
 *
 *   "empty"   — GEO ESearch succeeds but returns 0 UIDs (genuinely no matching datasets);
 *               OR ESummary returns data but no parseable Dataset objects were produced
 *               (e.g. all records lacked a recognised accession).
 *
 *   "partial" — NOT achievable in GEO's current 2-step pipeline. Both ESearch and ESummary
 *               are single batch calls that either fully succeed or fully fail as a unit.
 *               A future GEO implementation making per-record API calls (e.g. per-GSE
 *               supplementary metadata) could produce "partial" status when some records
 *               succeed and others fail. When that happens, follow the PubMed EFetch pattern:
 *               set status "partial", include the successfully retrieved records in data[],
 *               and set error to describe the partial failure.
 *
 *   "success" — Both stages (GEO ESearch, GEO ESummary) succeed and data.length > 0.
 */
export async function searchGeoDatasets(query: string): Promise<ModuleResult<Dataset>> {
  const startedAt = performance.now();

  // ── Stage 1: GEO ESearch → UIDs ──────────────────────────────────────────
  // searchGeoIds throws on HTTP error or network failure.
  // If this stage fails → status "error" (no usable data at all).
  let uids: string[];
  try {
    uids = await searchGeoIds(query);
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
    // GEO ESearch succeeded but found 0 matching dataset UIDs → genuinely empty
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
  // If this stage fails → status "error": we have UIDs but no dataset metadata to return.
  // (Unlike PubMed's EFetch, there is no fallback dataset representation from UIDs alone.)
  let datasets: Dataset[];
  try {
    const summaryData = await fetchGeoSummaries(uids);
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

  // Both stages succeeded
  return buildModuleResult({
    module: "geo",
    status: datasets.length > 0 ? "success" : "empty",
    data: datasets,
    error: null,
    startedAt,
  });
}

// Re-export types and sub-functions for consumers that want fine-grained access
export type { Dataset } from "@/types/dataset";
export { searchGeoIds } from "./search";
export { fetchGeoSummaries } from "./summary";
export { parseGeoResults } from "./parser";
