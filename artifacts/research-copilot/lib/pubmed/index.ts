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

/**
 * Search PubMed for papers matching `query` and return up to 10 Paper objects.
 * ESummary and EFetch run in parallel to minimise latency.
 * Returns an empty array on any failure — never throws.
 */
export async function searchPubMed(query: string): Promise<Paper[]> {
  try {
    const pmids = await searchPubMedIds(query);
    if (pmids.length === 0) return [];

    // ESummary (metadata) and EFetch (abstracts + MeSH) run concurrently
    const [summaryData, abstractData] = await Promise.all([
      fetchPaperSummaries(pmids),
      fetchPaperAbstracts(pmids),
    ]);

    return parsePubMedResults(summaryData, abstractData);
  } catch (err) {
    console.error("[searchPubMed] Pipeline failed:", err);
    return [];
  }
}

// Re-export types for consumers that want fine-grained access
export type { Paper } from "@/types/paper";
export { searchPubMedIds } from "./search";
export { fetchPaperSummaries } from "./summary";
export { fetchPaperAbstracts } from "./abstract";
export { extractMeshTerms } from "./mesh";
export { parsePubMedResults } from "./parser";
