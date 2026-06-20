/**
 * MeSH (Medical Subject Headings) extraction module
 *
 * MeSH is the NLM controlled vocabulary for indexing biomedical literature.
 * Terms are available in EFetch XML under <MeshHeadingList><MeshHeading><DescriptorName>.
 *
 * TODO: Distinguish MajorTopicYN="Y" terms (primary subjects) from minor ones
 * TODO: Include QualifierName subheadings for finer-grained classification
 * TODO: Use MeSH terms as inputs to OpenAI for topic clustering
 * TODO: Map MeSH terms to vector embeddings for semantic similarity search (RAG)
 */

/**
 * Extract all MeSH descriptor names from a block of PubMed XML.
 * Works on both a single-article XML fragment and a full EFetch document.
 * Returns an empty array if no MeSH headings are present or parsing fails.
 */
export function extractMeshTerms(xmlData: string): string[] {
  try {
    const terms = [...xmlData.matchAll(/<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g)].map(
      (m) => m[1].trim()
    );
    return [...new Set(terms)]; // deduplicate across qualifier/subheading repeats
  } catch {
    return [];
  }
}
