/**
 * Represents a PubMed article retrieved from the NCBI PubMed API.
 *
 * Future fields to add when PubMed integration is implemented:
 *   - abstract: string        — full article abstract
 *   - doi: string             — Digital Object Identifier
 *   - keywords: string[]      — author-supplied keywords
 *   - meshTerms: string[]     — MeSH (Medical Subject Headings) controlled vocabulary terms
 */
export interface Paper {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  year: string;
}
