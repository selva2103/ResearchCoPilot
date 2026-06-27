/**
 * GEO ESearch module
 *
 * NCBI ESearch with db=gds retrieves GEO DataSet UIDs matching a query.
 * Returns both the paginated UID list (up to retmax) AND the total count
 * of matching records from NCBI — so callers can distinguish "NCBI found N
 * total but we only fetched 10" from "NCBI found 0".
 *
 * Observed behaviour from live API:
 *   - All returned UIDs for life-science queries are GSE-type records.
 *   - UIDs are 9-digit numbers (e.g. "200335950" → GSE335950).
 *   - The count field is a string in the JSON response.
 *
 * Pagination: NCBI ESearch paginates via `retstart` (offset) and `retmax` (limit).
 * The practical ceiling is retstart + retmax ≈ 9,999 for the history-less approach.
 * Callers are responsible for detecting and capping this ceiling before calling here.
 *
 * WebEnv/QueryKey: NCBI's history server (usehistory=y) can paginate beyond the ceiling
 * but is NOT implemented here. Explicitly deferred to a future phase.
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 * GEO search fields: https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Support GDS[ETYP] (curated datasets) as a secondary search
 * TODO: Add date filter (e.g. last 5 years) for fresher results
 * TODO: Implement WebEnv/QueryKey history server to bypass the retstart+retmax ceiling
 */

import { fetchWithRetry } from "@/lib/utils";

const ESEARCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

interface ESearchResponse {
  esearchresult: {
    count: string;
    retmax: string;
    idlist: string[];
  };
}

export interface GeoSearchResult {
  /** UIDs of the top matching GEO records for the requested page */
  uids: string[];
  /**
   * Total number of GEO records matching this query in NCBI,
   * BEFORE any pagination or parser-side filtering (e.g. GSE-only filter).
   * Use this to distinguish "0 from NCBI" from "0 after filtering N records."
   * Also used to compute hasMore, totalPages, and hitUpstreamLimit.
   */
  totalCount: number;
}

/**
 * Search GEO DataSets (db=gds) for UIDs matching `query`, with pagination via limit/offset.
 *
 * @param query  - Free-text search query
 * @param limit  - Maximum records to return (maps to NCBI retmax). Default: 10.
 * @param offset - Zero-based record offset (maps to NCBI retstart). Default: 0.
 *
 * Callers MUST cap offset+limit to 9,999 before calling here to stay within NCBI's
 * practical ESearch ceiling. The module index (index.ts) does this automatically.
 *
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors.
 */
export async function searchGeoIds(
  query: string,
  limit: number = 10,
  offset: number = 0
): Promise<GeoSearchResult> {
  const params = new URLSearchParams({
    db: "gds",
    term: query,
    retmax: String(limit),
    retstart: String(offset),
    retmode: "json",
    sort: "relevance",
  });

  const res = await fetchWithRetry(`${ESEARCH_BASE}?${params}`);
  if (!res.ok) throw new Error(`GEO ESearch HTTP ${res.status}`);

  const data = (await res.json()) as ESearchResponse;
  return {
    uids: data.esearchresult.idlist ?? [],
    totalCount: parseInt(data.esearchresult.count ?? "0", 10),
  };
}
