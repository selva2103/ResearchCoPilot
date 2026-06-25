/**
 * PubMed ESearch module
 *
 * NCBI ESearch converts a text query into a list of PubMed IDs (PMIDs).
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Support pagination (retstart) for fetching beyond the first page
 * TODO: Use usehistory=y + WebEnv/query_key for large result sets
 */

import { fetchWithRetry } from "@/lib/utils";

const ESEARCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

interface ESearchResponse {
  esearchresult: {
    idlist: string[];
    count: string;
    retmax: string;
  };
}

/**
 * Search PubMed for the top 10 PMIDs matching `query`, sorted by relevance.
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors
 * and maps them to the correct ModuleResult status.
 */
export async function searchPubMedIds(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: "10",
    retmode: "json",
    sort: "relevance",
  });

  const res = await fetchWithRetry(`${ESEARCH_BASE}?${params}`);
  if (!res.ok) throw new Error(`ESearch HTTP ${res.status}`);

  const data = (await res.json()) as ESearchResponse;
  return data.esearchresult.idlist ?? [];
}
