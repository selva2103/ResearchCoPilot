/**
 * GEO ESummary module
 *
 * NCBI ESummary with db=gds returns metadata for GEO DataSet UIDs.
 * Field names are all lowercase in the actual API response.
 * Key fields per record: accession, title, summary, taxon, n_samples, gpl, platformtitle.
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESummary
 *
 * TODO: Add NCBI_API_KEY env var to raise rate limit
 * TODO: Use ELink to fetch linked PubMed articles per dataset (db=gds → db=pubmed)
 * TODO: Fetch citation counts via iCite for linked PubMed articles
 */

import { fetchWithRetry } from "@/lib/utils";

const ESUMMARY_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

export interface GeoSummaryRecord {
  uid: string;
  /** GEO Series accession, e.g. "GSE313389" */
  accession?: string;
  title?: string;
  summary?: string;
  /** Organism studied, e.g. "Homo sapiens" */
  taxon?: string;
  /** Number of samples in the dataset */
  n_samples?: number | string;
  /** Platform numeric ID (without the GPL prefix), e.g. "24676" */
  gpl?: string | number;
  /** Platform full title, e.g. "[HG-U133_Plus_2] Affymetrix Human Genome..." */
  platformtitle?: string;
  /** Entry type: "GSE", "GDS", "GPL" etc. */
  entrytype?: string;
  /** Technology / data type, e.g. "Expression profiling by high throughput sequencing" */
  gdstype?: string;
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
