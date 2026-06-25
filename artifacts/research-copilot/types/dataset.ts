/**
 * GeoDataset — a GEO Series (GSE) record retrieved from the NCBI GEO API.
 *
 * All fields are populated from ESearch + ESummary (db=gds). There is no
 * GEO EFetch equivalent for full-text data — the 2-step pipeline (ESearch →
 * ESummary) is correct and complete for GEO.
 *
 * Download URLs are constructed from the `ftplink` field returned by
 * ESummary using NCBI's documented, predictable FTP directory pattern:
 *   {ftpBase}matrix/{accession}_series_matrix.txt.gz
 *   {ftpBase}soft/{accession}_family.soft.gz
 *   {ftpBase}miniml/{accession}_family.xml.tgz
 * These were verified to resolve for real GSE accessions.
 *
 * Future additions:
 *   - relatedDatasets: string[]    — similar GEO accessions via ELink gds→gds
 *   - vectorEmbedding: number[]    — for RAG / semantic search
 *   - sampleMetadata: GsmRecord[]  — per-sample GSM metadata
 *   - differentialExpression: ...  — DE results when geo2r = "yes"
 */

/**
 * Represents a GEO Series (GSE) dataset returned by the GEO module.
 * Used by ModuleResult<Dataset> throughout the TypeScript pipeline.
 * Also exported as GeoDataset for consumers that prefer that name.
 */
export interface Dataset {
  // ── Core fields (always present) ────────────────────────────────────────

  /** GEO Series accession number, e.g. "GSE12345" */
  accession: string;

  /** Full dataset title */
  title: string;

  /** Organism(s) studied, e.g. "Homo sapiens", "Mus musculus" */
  organism: string;

  /** Platform identifier, e.g. "GPL570" or "GPL30172" */
  platform: string;

  // ── Extended metadata (populated when available from ESummary) ───────────

  /** Technology / experiment type, e.g. "Expression profiling by high throughput sequencing" */
  experimentType?: string;

  /** Number of samples in the dataset */
  sampleCount?: number;

  /** Publication / submission date, ISO format "YYYY-MM-DD" */
  publicationDate?: string;

  /** Linked PubMed article IDs (from ESummary pubmedids field) */
  pubmedIds?: string[];

  /** Brief description of the dataset's purpose and findings */
  summary?: string;

  // ── Links (constructed or sourced from ESummary) ─────────────────────────

  /** Direct link to the dataset on the GEO website */
  geoUrl?: string;

  /**
   * HTTPS link to the NCBI FTP directory for this dataset.
   * Derived from ESummary ftplink by replacing ftp:// → https://.
   * Verified to be browsable for all GSE datasets.
   */
  ftpDownloadUrl?: string;

  /**
   * Direct download URL for the Series Matrix file (.txt.gz).
   * Constructed from ftplink + "matrix/" + accession + "_series_matrix.txt.gz".
   * Verified to resolve with HTTP 200 for GSE datasets.
   */
  seriesMatrixUrl?: string;

  /**
   * Direct download URL for the SOFT family file (.soft.gz).
   * Constructed from ftplink + "soft/" + accession + "_family.soft.gz".
   * Verified to resolve with HTTP 200 for GSE datasets.
   */
  softFileUrl?: string;

  /**
   * Direct download URL for the MINiML family file (.xml.tgz).
   * Constructed from ftplink + "miniml/" + accession + "_family.xml.tgz".
   * Verified to resolve with HTTP 200 for GSE datasets.
   */
  miniMLUrl?: string;
}

/** Alias for consumers that prefer the full GeoDataset name. */
export type GeoDataset = Dataset;
