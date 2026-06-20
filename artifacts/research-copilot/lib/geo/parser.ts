/**
 * GEO result parser
 *
 * Converts raw ESummary GEO records into typed Dataset objects.
 * All field access is defensive — missing data is omitted rather than
 * set to empty strings or throwing.
 *
 * Confirmed field names from live NCBI ESummary (db=gds):
 *   accession, title, summary, taxon, n_samples, gpl, platformtitle, entrytype, gdstype
 *
 * TODO: Parse gdstype for human-readable technology label (e.g. "RNA-Seq")
 * TODO: Add relatedDatasets[] via ELink (gds → gds similarity links)
 * TODO: Add vectorEmbedding[] once OpenAI embeddings are integrated (for RAG)
 */

import type { Dataset } from "@/types/dataset";
import type { GeoSummaryResult, GeoSummaryRecord } from "./summary";

/**
 * Convert a raw GeoSummaryResult into an array of Dataset objects.
 * Skips records with no recognisable accession (they can't produce a GEO URL).
 */
export function parseGeoResults(summaryData: GeoSummaryResult | null): Dataset[] {
  if (!summaryData) return [];

  const { uids } = summaryData.result;
  if (!Array.isArray(uids) || uids.length === 0) return [];

  return uids.reduce<Dataset[]>((acc, uid) => {
    const record = summaryData.result[uid] as GeoSummaryRecord | undefined;
    if (!record || typeof record !== "object") return acc;

    // GEO accession (e.g. "GSE313389")
    const accession = record.accession?.trim();
    if (!accession) return acc; // skip records without an accession

    // Platform: gpl holds just the numeric part (e.g. "24676"), so prefix with "GPL"
    const gplRaw = record.gpl != null ? String(record.gpl).trim() : "";
    const platform =
      record.platformtitle?.trim() ||
      (gplRaw ? `GPL${gplRaw}` : "Unknown platform");

    // Sample count: may be number or stringified number
    const rawSamples = record.n_samples;
    const sampleCount =
      rawSamples != null
        ? typeof rawSamples === "number"
          ? rawSamples
          : parseInt(String(rawSamples), 10) || undefined
        : undefined;

    // Summary: use as-is; UI truncates to 200 chars
    const summary = record.summary?.trim() || undefined;

    const dataset: Dataset = {
      accession,
      title: record.title?.trim() || "Untitled dataset",
      organism: record.taxon?.trim() || "Unknown organism",
      platform,
      geoUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
      ...(sampleCount !== undefined && { sampleCount }),
      ...(summary && { summary }),
    };

    acc.push(dataset);
    return acc;
  }, []);
}
