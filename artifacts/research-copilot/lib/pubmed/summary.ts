/**
 * PubMed ESummary module
 *
 * NCBI ESummary retrieves document summaries (metadata) for a list of PMIDs.
 * Returns a JSON object keyed by PMID with fields like title, authors, source, pubdate.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Fetch citation counts via iCite API (https://icite.od.nih.gov/api)
 * TODO: Add similar-articles lookup via ELink API
 */

import { fetchWithRetry } from "@/lib/utils";

const ESUMMARY_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

export interface ESummaryAuthor {
  name: string;
}

export interface ESummaryArticle {
  uid: string;
  title: string;
  authors: ESummaryAuthor[];
  /** Journal / source name */
  source: string;
  /** Raw pubdate string, e.g. "2023 Apr 15" or "2023" */
  pubdate: string;
}

export interface ESummaryResult {
  result: {
    uids: string[];
    [pmid: string]: ESummaryArticle | string[];
  };
}

/**
 * Fetch ESummary metadata for an array of PMIDs.
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors
 * and maps them to the correct ModuleResult status.
 */
export async function fetchPaperSummaries(
  pmids: string[]
): Promise<ESummaryResult> {
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "json",
  });

  const res = await fetchWithRetry(`${ESUMMARY_BASE}?${params}`);
  if (!res.ok) throw new Error(`ESummary HTTP ${res.status}`);

  return (await res.json()) as ESummaryResult;
}
