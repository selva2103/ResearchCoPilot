/**
 * PubMed result parser
 *
 * Merges ESummary metadata and EFetch full-record data into typed Paper objects.
 *
 * TODO: Add citation count field once iCite integration is added
 * TODO: Add similarArticles[] from ELink API results
 * TODO: Add vectorEmbedding[] once OpenAI embeddings are integrated (for RAG)
 * TODO: Parse author keywords from <KeywordList> in EFetch XML
 */

import type { Paper } from "@/types/paper";
import type { ESummaryResult, ESummaryArticle } from "./summary";
import type { AbstractDetails } from "./abstract";

/**
 * Convert raw ESummary + EFetch data into an array of Paper objects.
 * Missing fields are omitted rather than set to empty strings.
 */
export function parsePubMedResults(
  summaryData: ESummaryResult | null,
  abstractData: Record<string, AbstractDetails>
): Paper[] {
  if (!summaryData) return [];

  const { uids } = summaryData.result;
  if (!Array.isArray(uids) || uids.length === 0) return [];

  return uids.reduce<Paper[]>((acc, pmid) => {
    const article = summaryData.result[pmid] as ESummaryArticle | undefined;
    if (!article || typeof article !== "object") return acc;

    const extra = abstractData[pmid] ?? {};

    const paper: Paper = {
      pmid,
      title: article.title ?? "Untitled",
      authors: (article.authors ?? []).map((a) => a.name),
      journal: article.source ?? "Unknown journal",
      // pubdate can be "2023 Apr 15", "2023 Apr", "2023", or "2023 Spring"
      year: (article.pubdate ?? "").match(/\d{4}/)?.[0] ?? "Unknown",
      pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      ...(extra.abstract && { abstract: extra.abstract }),
      ...(extra.doi && { doi: extra.doi }),
      ...(extra.meshTerms?.length && { meshTerms: extra.meshTerms }),
      ...(extra.publicationTypes?.length && {
        publicationTypes: extra.publicationTypes,
      }),
    };

    acc.push(paper);
    return acc;
  }, []);
}
