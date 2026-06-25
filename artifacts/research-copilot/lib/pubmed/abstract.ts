/**
 * PubMed EFetch module
 *
 * NCBI EFetch retrieves full article records in XML format, including:
 *   - Abstract text (plain and structured)
 *   - DOI
 *   - MeSH headings
 *   - Publication types
 *   - Author keywords
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.EFetch
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit
 * TODO: Parse author keywords from <KeywordList> when available
 * TODO: Parse funding info from <GrantList> for research context
 */

import { extractMeshTerms } from "./mesh";

import { fetchWithRetry } from "@/lib/utils";

const EFETCH_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

export interface AbstractDetails {
  abstract?: string;
  doi?: string;
  meshTerms?: string[];
  publicationTypes?: string[];
}

/**
 * Fetch full article records from EFetch for a list of PMIDs.
 * Parses abstract, DOI, MeSH terms, and publication types from XML.
 * Returns a Record keyed by PMID; missing fields are simply omitted.
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors
 * and maps them to the correct ModuleResult status (status "partial" when EFetch fails but
 * ESummary already succeeded and produced usable paper metadata).
 * Individual per-article XML parse failures are handled silently (the article is skipped).
 */
export async function fetchPaperAbstracts(
  pmids: string[]
): Promise<Record<string, AbstractDetails>> {
  if (pmids.length === 0) return {};

  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    rettype: "xml",
    retmode: "xml",
  });

  const res = await fetchWithRetry(`${EFETCH_BASE}?${params}`);
  if (!res.ok) throw new Error(`EFetch HTTP ${res.status}`);

  const xml = await res.text();
  return parseEFetchXml(xml);
}

// ─── Internal XML parser ──────────────────────────────────────────────────────

/**
 * Split the full EFetch XML document into per-article sections and parse each one.
 * Uses regex-based parsing — no external XML library required.
 */
function parseEFetchXml(xml: string): Record<string, AbstractDetails> {
  const result: Record<string, AbstractDetails> = {};

  // Each PubMed article is wrapped in <PubmedArticle>...</PubmedArticle>
  const articlePattern = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match: RegExpExecArray | null;

  while ((match = articlePattern.exec(xml)) !== null) {
    const articleXml = match[1];

    // PMID — take the first occurrence (Version="1")
    const pmid = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;

    // Abstract — join all <AbstractText> segments (handles structured abstracts)
    const abstractSegments = [
      ...articleXml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g),
    ]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    const abstract = abstractSegments.join(" ") || undefined;

    // DOI — inside <PubmedData><ArticleIdList>
    const doi =
      articleXml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1]?.trim() ??
      undefined;

    // Publication types
    const publicationTypes = [
      ...articleXml.matchAll(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/g),
    ]
      .map((m) => m[1].trim())
      .filter(Boolean);

    // MeSH terms — delegated to the dedicated mesh module
    const meshTerms = extractMeshTerms(articleXml);

    result[pmid] = {
      ...(abstract && { abstract }),
      ...(doi && { doi }),
      ...(meshTerms.length > 0 && { meshTerms }),
      ...(publicationTypes.length > 0 && { publicationTypes }),
    };
  }

  return result;
}
