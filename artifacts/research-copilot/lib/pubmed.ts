import type { Paper } from "@/types/paper";

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

// TODO: Add NCBI API key via environment variable (NCBI_API_KEY) to raise the
// rate limit from 3 req/s to 10 req/s:
//   const API_KEY = process.env.NCBI_API_KEY ?? "";

// TODO: Add efetch support to retrieve full abstracts:
//   GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi
//     ?db=pubmed&id=<pmids>&rettype=abstract&retmode=text

// TODO: Parse MeSH terms from the ESummary response field "MeshHeadingList"
// once the PubMed integration is extended.

interface ESearchResult {
  esearchresult: {
    idlist: string[];
  };
}

interface ESummaryAuthor {
  name: string;
}

interface ESummaryArticle {
  uid: string;
  title: string;
  authors: ESummaryAuthor[];
  source: string;       // journal name
  pubdate: string;      // e.g. "2023 Apr 15"
}

interface ESummaryResult {
  result: {
    uids: string[];
    [pmid: string]: ESummaryArticle | string[];
  };
}

/**
 * Search PubMed for the top 10 articles matching `query`.
 *
 * Steps:
 *  1. ESearch  — converts the query into a list of PubMed IDs (PMIDs)
 *  2. ESummary — retrieves article metadata for those PMIDs
 *
 * Returns an array of Paper objects, or an empty array on any failure.
 */
export async function searchPubMed(query: string): Promise<Paper[]> {
  try {
    // Step 1: ESearch — get top 10 PMIDs for the query
    const searchParams = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: "10",
      retmode: "json",
      sort: "relevance",
    });

    const searchRes = await fetch(`${ESEARCH_URL}?${searchParams.toString()}`);
    if (!searchRes.ok) {
      throw new Error(`ESearch failed with status ${searchRes.status}`);
    }

    const searchData = (await searchRes.json()) as ESearchResult;
    const pmids = searchData.esearchresult.idlist;

    if (pmids.length === 0) return [];

    // Step 2: ESummary — fetch article metadata for the retrieved PMIDs
    const summaryParams = new URLSearchParams({
      db: "pubmed",
      id: pmids.join(","),
      retmode: "json",
    });

    const summaryRes = await fetch(`${ESUMMARY_URL}?${summaryParams.toString()}`);
    if (!summaryRes.ok) {
      throw new Error(`ESummary failed with status ${summaryRes.status}`);
    }

    const summaryData = (await summaryRes.json()) as ESummaryResult;

    // Map each PMID to a Paper object
    return pmids.reduce<Paper[]>((acc, pmid) => {
      const article = summaryData.result[pmid] as ESummaryArticle | undefined;
      if (!article || typeof article !== "object") return acc;

      acc.push({
        pmid,
        title: article.title ?? "Untitled",
        authors: (article.authors ?? []).map((a) => a.name),
        journal: article.source ?? "Unknown journal",
        // pubdate is "YYYY Mon DD" or "YYYY" — extract the 4-digit year
        year: (article.pubdate ?? "").match(/\d{4}/)?.[0] ?? "Unknown",
      });

      return acc;
    }, []);
  } catch (err) {
    // Fail gracefully so callers always receive an array
    console.error("[searchPubMed] Error fetching from PubMed:", err);
    return [];
  }
}
