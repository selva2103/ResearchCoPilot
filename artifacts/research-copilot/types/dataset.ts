/**
 * Represents a GEO (Gene Expression Omnibus) dataset retrieved from the NCBI GEO API.
 *
 * Core fields are populated from ESearch + ESummary (db=gds).
 * Extended optional fields (sampleCount, summary, geoUrl) are populated when available.
 *
 * Future additions:
 *   - pubmedIds: string[]        — linked PubMed articles via ELink
 *   - relatedDatasets: string[]  — similar GEO accessions
 *   - vectorEmbedding: number[]  — for RAG / semantic search
 */
export interface Dataset {
  /** GEO Series accession number (e.g. "GSE12345") */
  accession: string;

  /** Full dataset title */
  title: string;

  /** Organism(s) studied (e.g. "Homo sapiens", "Mus musculus") */
  organism: string;

  /** Sequencing / microarray platform (e.g. "GPL570", "Illumina HiSeq 2000") */
  platform: string;

  /** Number of samples in the dataset */
  sampleCount?: number;

  /** Brief description of the dataset's purpose and findings */
  summary?: string;

  /** Direct link to the dataset on the GEO website */
  geoUrl?: string;
}
