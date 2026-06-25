/**
 * PubMed integration — public API
 *
 * Full pipeline:
 *
 *   query
 *     ↓  ESearch  (search.ts)
 *   pmids[]
 *     ↓  ESummary + EFetch in parallel  (summary.ts / abstract.ts)
 *   summaryData + abstractData
 *     ↓  parser  (parser.ts)
 *   Paper[]
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
import { searchPubMedIds } from "./search";
import { fetchPaperSummaries } from "./summary";
import { fetchPaperAbstracts } from "./abstract";
import { parsePubMedResults } from "./parser";

export interface PubMedResult {
  papers: Paper[];
  /** Present when the pipeline failed (e.g. NCBI rate-limited) vs. a genuine zero-result query */
  error?: string;
}

/**
 * Search PubMed for papers matching `query` and return up to 10 Paper objects.
 * ESummary and EFetch run in parallel to minimise latency.
 * Returns an empty papers array on any failure — never throws.
 * Sets `error` when the failure is due to a backend issue (e.g. HTTP 429) so
 * callers can distinguish a rate-limit from a genuine zero-result query.
 */
export async function searchPubMed(query: string): Promise<PubMedResult> {
  try {
    const pmids = await searchPubMedIds(query);
    if (pmids.length === 0) return { papers: [] };

    // ESummary (metadata) and EFetch (abstracts + MeSH) run concurrently
    const [summaryData, abstractData] = await Promise.all([
      fetchPaperSummaries(pmids),
      fetchPaperAbstracts(pmids),
    ]);

    const papers = parsePubMedResults(summaryData, abstractData);
    return { papers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = message.includes("429");
    return {
      papers: [],
      error: isRateLimit
        ? "NCBI is temporarily rate-limiting requests. Try again in a few seconds."
        : `PubMed search failed: ${message}`,
    };
  }
}

// Re-export types for consumers that want fine-grained access
export type { Paper } from "@/types/paper";
export { searchPubMedIds } from "./search";
export { fetchPaperSummaries } from "./summary";
export { fetchPaperAbstracts } from "./abstract";
export { extractMeshTerms } from "./mesh";
export { parsePubMedResults } from "./parser";
