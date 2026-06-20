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
 * Returns an empty array on any failure so callers never have to handle exceptions.
 */
export async function searchPubMedIds(query: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: "10",
      retmode: "json",
      sort: "relevance",
    });

    const res = await fetch(`${ESEARCH_BASE}?${params}`);
    if (!res.ok) throw new Error(`ESearch HTTP ${res.status}`);

    const data = (await res.json()) as ESearchResponse;
    return data.esearchresult.idlist ?? [];
  } catch (err) {
    console.error("[searchPubMedIds] ESearch failed:", err);
    return [];
  }
}
