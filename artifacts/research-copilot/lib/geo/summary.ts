/**
 * GEO ESummary module
 *
 * NCBI ESummary with db=gds returns metadata for GEO DataSet UIDs.
 * All field names are lowercase in the actual API response.
 *
 * Fields confirmed from live NCBI ESummary (db=gds) inspection:
 *   uid, accession, gds, title, summary, gpl, gse, taxon, entrytype,
 *   gdstype, ptechtype, valtype, pdat, suppfile, samples, n_samples,
 *   seriestitle, platformtitle, platformtaxa, samplestaxa, pubmedids,
 *   projects, ftplink, geo2r, bioproject, relations, extrelations
 *
 * Observed quirks:
 *   - platformtitle is consistently an empty string in live records;
 *     platform display must use GPL${gpl} fallback.
 *   - ftplink IS returned by the API (no URL construction needed for the base).
 *   - pubmedids is an array (possibly empty) of pubmed ID strings.
 *   - n_samples is an integer (not a string).
 *   - pdat format is "YYYY/MM/DD".
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit from 3 req/s → 10 req/s
 * TODO: Use ELink to fetch related GEO datasets per result (gds → gds similarity)
 * TODO: Fetch citation counts via iCite for linked PubMed articles
 */

import { fetchWithRetry } from "@/lib/utils";

const ESUMMARY_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

/** A single sample record embedded within a GeoSummaryRecord */
export interface GeoSampleRef {
  accession: string;
  title: string;
}

/**
 * Raw ESummary record for a single GEO DataSet (db=gds).
 * All fields are typed from live API inspection — field names are lowercase as returned.
 */
export interface GeoSummaryRecord {
  uid: string;

  /** Full GEO Series accession, e.g. "GSE335950" */
  accession?: string;

  /** Numeric part of the GSE accession (without "GSE" prefix) */
  gse?: string | number;

  title?: string;
  summary?: string;

  /** Organism studied, e.g. "Homo sapiens" */
  taxon?: string;

  /** Number of samples (integer in live API) */
  n_samples?: number | string;

  /** Platform numeric ID without prefix, e.g. "30172" → display as "GPL30172" */
  gpl?: string | number;

  /**
   * Platform full title — observed as consistently empty string in live API.
   * Fall back to GPL${gpl} for display.
   */
  platformtitle?: string;

  /** Entry type: "GSE" (Series), "GDS" (curated DataSet), "GPL" (Platform), "GSM" (Sample) */
  entrytype?: string;

  /**
   * Experiment / technology type, e.g.:
   *   "Expression profiling by high throughput sequencing"
   *   "Genome binding/occupancy profiling by high throughput sequencing"
   *   "Expression profiling by array"
   */
  gdstype?: string;

  /** Publication / submission date in "YYYY/MM/DD" format */
  pdat?: string;

  /** Supplementary file types, e.g. "TXT", "NARROWPEAK" */
  suppfile?: string;

  /** Array of linked PubMed IDs (may be empty) */
  pubmedids?: string[];

  /**
   * FTP directory URL for this dataset, e.g.:
   *   "ftp://ftp.ncbi.nlm.nih.gov/geo/series/GSE335nnn/GSE335950/"
   * Always ends with "/". Convert ftp:// → https:// for HTTP access.
   */
  ftplink?: string;

  /**
   * Whether NCBI GEO2R analysis is available ("yes" | "no").
   * "yes" = Series Matrix file exists and R-based DE analysis is supported.
   */
  geo2r?: string;

  /** NCBI BioProject accession, e.g. "PRJNA1479994" */
  bioproject?: string;

  /** Embedded sample references (array of {accession, title}) */
  samples?: GeoSampleRef[];
}

export interface GeoSummaryResult {
  result: {
    uids: string[];
    [uid: string]: GeoSummaryRecord | string[];
  };
}

/**
 * Fetch ESummary metadata for an array of GEO UIDs (db=gds).
 * Throws on HTTP error or network failure — the calling module (index.ts) handles all errors
 * and maps them to the correct ModuleResult status.
 */
export async function fetchGeoSummaries(
  uids: string[]
): Promise<GeoSummaryResult> {
  const params = new URLSearchParams({
    db: "gds",
    id: uids.join(","),
    retmode: "json",
  });

  const res = await fetchWithRetry(`${ESUMMARY_BASE}?${params}`);
  if (!res.ok) throw new Error(`GEO ESummary HTTP ${res.status}`);

  return (await res.json()) as GeoSummaryResult;
}
