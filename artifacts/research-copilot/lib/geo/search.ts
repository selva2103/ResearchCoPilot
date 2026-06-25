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
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
 * GEO search fields: https://www.ncbi.nlm.nih.gov/geo/info/geo_paccess.html
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Support GDS[ETYP] (curated datasets) as a secondary search
 * TODO: Add date filter (e.g. last 5 years) for fresher results
 * TODO: Support pagination (retstart) for additional results beyond first page
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
  /** UIDs of the top matching GEO records (up to retmax) */
  uids: string[];
  /**
   * Total number of GEO records matching this query in NCBI,
   * BEFORE any pagination or parser-side filtering.
   * Use this to distinguish "0 from NCBI" from "0 after filtering N records."
   */
  totalCount: number;
}

/**
 * Search GEO DataSets (db=gds) for the top 10 UIDs matching `query`.
 * Returns both the UID list and the raw NCBI total match count.
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors.
 */
export async function searchGeoIds(query: string): Promise<GeoSearchResult> {
  const params = new URLSearchParams({
    db: "gds",
    term: query,
    retmax: "10",
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
