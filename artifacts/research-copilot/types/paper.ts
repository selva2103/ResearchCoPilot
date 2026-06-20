/**
 * Represents a PubMed article retrieved from the NCBI APIs.
 *
 * Core fields are populated from ESearch + ESummary.
 * Extended fields (doi, abstract, meshTerms, keywords, publicationTypes, pubmedUrl)
 * are populated from EFetch and will be enriched further as the integration matures.
 *
 * Future additions:
 *   - citationCount: number      — from Europe PMC or iCite
 *   - similarArticles: string[]  — PMIDs of related papers
 *   - vectorEmbedding: number[]  — for RAG / semantic search
 */
export interface Paper {
  /** PubMed unique identifier */
  pmid: string;

  /** Full article title */
  title: string;

  /** List of author names in "Surname Initials" format */
  authors: string[];

  /** Journal / source name */
  journal: string;

  /** 4-digit publication year */
  year: string;

  /** Digital Object Identifier (e.g. "10.1038/s41586-023-05739-9") */
  doi?: string;

  /** Full abstract text; structured abstracts are joined with a space */
  abstract?: string;

  /**
   * MeSH (Medical Subject Headings) controlled vocabulary terms.
   * Useful for topic classification and semantic similarity.
   * TODO: use for keyword extraction and AI reasoning layer
   */
  meshTerms?: string[];

  /**
   * Author-supplied keywords.
   * TODO: parse from EFetch KeywordList when available
   */
  keywords?: string[];

  /** NLM publication type labels (e.g. "Journal Article", "Review", "Clinical Trial") */
  publicationTypes?: string[];

  /** Direct link to the article on PubMed */
  pubmedUrl?: string;
}
