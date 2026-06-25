/**
 * GEO integration — public API
 *
 * Full pipeline:
 *
 *   query
 *     ↓  ESearch (db=gds)  →  searchGeoIds()
 *   uids[]
 *     ↓  ESummary (db=gds) →  fetchGeoSummaries()
 *   raw GEO records
 *     ↓  parseGeoResults()
 *   Dataset[]
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
import { searchGeoIds } from "./search";
import { fetchGeoSummaries } from "./summary";
import { parseGeoResults } from "./parser";

export interface GeoResult {
  datasets: Dataset[];
  /** Present when the pipeline failed (e.g. NCBI rate-limited) vs. a genuine zero-result query */
  error?: string;
}

/**
 * Search GEO for datasets matching `query` and return up to 10 Dataset objects.
 * Returns an empty datasets array on any failure — never throws.
 * Sets `error` when the failure is due to a backend issue (e.g. HTTP 429) so
 * callers can distinguish a rate-limit from a genuine zero-result query.
 */
export async function searchGeoDatasets(query: string): Promise<GeoResult> {
  try {
    const uids = await searchGeoIds(query);
    if (uids.length === 0) return { datasets: [] };

    const summaryData = await fetchGeoSummaries(uids);
    const datasets = parseGeoResults(summaryData);
    return { datasets };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = message.includes("429");
    return {
      datasets: [],
      error: isRateLimit
        ? "NCBI is temporarily rate-limiting requests. Try again in a few seconds."
        : `GEO search failed: ${message}`,
    };
  }
}

// Re-export types and sub-functions for consumers that want fine-grained access
export type { Dataset } from "@/types/dataset";
export { searchGeoIds } from "./search";
export { fetchGeoSummaries } from "./summary";
export { parseGeoResults } from "./parser";
