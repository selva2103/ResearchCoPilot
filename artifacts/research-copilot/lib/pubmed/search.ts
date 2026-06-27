/**
 * PubMed ESearch module
 *
 * NCBI ESearch converts a text query into a list of PubMed IDs (PMIDs).
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 *
 * Pagination: NCBI ESearch paginates via `retstart` (offset) and `retmax` (limit).
 * The practical ceiling is retstart + retmax ≈ 9,999 for the history-less approach.
 * Callers are responsible for detecting and capping this ceiling before calling here.
 *
 * WebEnv/QueryKey: NCBI's history server (usehistory=y) can paginate beyond the ceiling
 * but is NOT implemented here. Explicitly deferred to a future phase.
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Support GDS[ETYP] (curated datasets) as secondary search — in geo/search.ts
 * TODO: Implement WebEnv/QueryKey history server to bypass the retstart+retmax ceiling
 * TODO: Add date filter support (e.g. last 5 years) for fresher results
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
 * Result returned by searchPubMedIds — both the PMID list AND the raw NCBI total count.
 * The totalCount is the upstream count BEFORE any pagination or parser-side filtering.
 * Callers use it to compute hasMore, totalPages, and hitUpstreamLimit.
 */
export interface PubMedSearchResult {
  /** PMIDs of the matching papers for the requested page */
  pmids: string[];
  /**
   * Total number of PubMed records matching this query, as reported by NCBI ESearch.
   * This is the raw NCBI total — it may be in the millions for broad queries.
   * Use this to compute hasMore and to display "N papers found".
   */
  totalCount: number;
}

/**
 * Search PubMed for PMIDs matching `query`, with pagination via limit/offset.
 *
 * @param query  - Free-text search query (same as NCBI PubMed search bar)
 * @param limit  - Maximum records to return (maps to NCBI retmax). Default: 10. Max: 10,000.
 * @param offset - Zero-based record offset (maps to NCBI retstart). Default: 0.
 *
 * Callers MUST cap offset+limit to 9,999 before calling here to stay within NCBI's
 * practical ESearch ceiling. The module index (index.ts) does this automatically.
 *
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors.
 */
export async function searchPubMedIds(
  query: string,
  limit: number = 10,
  offset: number = 0
): Promise<PubMedSearchResult> {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(limit),
    retstart: String(offset),
    retmode: "json",
    sort: "relevance",
  });

  const res = await fetchWithRetry(`${ESEARCH_BASE}?${params}`);
  if (!res.ok) throw new Error(`ESearch HTTP ${res.status}`);

  const data = (await res.json()) as ESearchResponse;
  return {
    pmids: data.esearchresult.idlist ?? [],
    totalCount: parseInt(data.esearchresult.count ?? "0", 10),
  };
}
