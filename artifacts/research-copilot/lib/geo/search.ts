/**
 * GEO ESearch module
 *
 * NCBI ESearch with db=gds retrieves GEO DataSet UIDs matching a query.
 * We restrict to GSE (Series) entry type which are researcher-submitted datasets
 * with raw or processed data — the most broadly useful result type.
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
    idlist: string[];
    count: string;
    retmax: string;
  };
}

/**
 * Search GEO DataSets (db=gds) for the top 10 UIDs matching `query`.
 * Restricts to GSE (Series) entry type for researcher-submitted datasets.
 * Returns [] on any failure — never throws.
 */
export async function searchGeoIds(query: string): Promise<string[]> {
  try {
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
    return data.esearchresult.idlist ?? [];
  } catch (err) {
    console.error("[searchGeoIds] ESearch failed:", err);
    return [];
  }
}
