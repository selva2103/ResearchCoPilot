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

/**
 * Search GEO for datasets matching `query` and return up to 10 Dataset objects.
 * Returns an empty array on any failure — never throws.
 */
export async function searchGeoDatasets(query: string): Promise<Dataset[]> {
  try {
    const uids = await searchGeoIds(query);
    if (uids.length === 0) return [];

    const summaryData = await fetchGeoSummaries(uids);
    return parseGeoResults(summaryData);
  } catch (err) {
    console.error("[searchGeoDatasets] Pipeline failed:", err);
    return [];
  }
}

// Re-export types and sub-functions for consumers that want fine-grained access
export type { Dataset } from "@/types/dataset";
export { searchGeoIds } from "./search";
export { fetchGeoSummaries } from "./summary";
export { parseGeoResults } from "./parser";
