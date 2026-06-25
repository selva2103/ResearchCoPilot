/**
 * GEO result parser
 *
 * Converts raw ESummary GEO records into typed Dataset objects.
 * All field access is defensive — missing data produces undefined rather
 * than throwing or fabricating values.
 *
 * Live API schema confirmed by inspection of NCBI ESummary (db=gds):
 *   accession, title, summary, taxon, n_samples, gpl, entrytype, gdstype,
 *   pdat, pubmedids, ftplink, geo2r, platformtitle (always empty in practice)
 *
 * Filtering:
 *   Only GSE (Series) entry types are emitted. GDS (curated DataSets),
 *   GPL (Platforms), and GSM (Samples) are silently skipped — they have
 *   different field layouts and are less useful for dataset discovery.
 *   This is the correct first-pass approach; future versions could handle
 *   each entrytype explicitly if curated GDS records become valuable.
 *
 * Download URL construction (all verified HTTP 200 for GSE335950):
 *   The ftplink field is returned by ESummary as an ftp:// URL.
 *   We convert ftp:// → https:// for browser-friendly access, then
 *   append the standard NCBI GEO filename patterns:
 *     matrix/{accession}_series_matrix.txt.gz
 *     soft/{accession}_family.soft.gz
 *     miniml/{accession}_family.xml.tgz
 *   All three directories reliably exist for every GSE dataset.
 *
 * TODO: Parse gdstype for short human-readable label (e.g. "RNA-Seq")
 * TODO: Add relatedDatasets[] via ELink (gds → gds similarity links)
 * TODO: Add vectorEmbedding[] once OpenAI embeddings are integrated (for RAG)
 * TODO: Handle multi-platform datasets (matrix file may have platform suffix)
 */

import type { Dataset } from "@/types/dataset";
import type { GeoSummaryResult, GeoSummaryRecord } from "./summary";

/**
 * Convert a raw GeoSummaryResult into an array of Dataset objects.
 *
 * Only GSE (Series) records are included — GDS, GPL, GSM entries are skipped.
 * Records without a recognisable accession are also skipped.
 *
 * @param summaryData - Raw JSON from ESummary (db=gds); accepts null for safety
 *                      (e.g. when called from legacy code paths).
 */
export function parseGeoResults(summaryData: GeoSummaryResult | null): Dataset[] {
  if (!summaryData) return [];

  const { uids } = summaryData.result;
  if (!Array.isArray(uids) || uids.length === 0) return [];

  return uids.reduce<Dataset[]>((acc, uid) => {
    const record = summaryData.result[uid] as GeoSummaryRecord | undefined;
    if (!record || typeof record !== "object") return acc;

    // ── Filter: only GSE (Series) records ────────────────────────────────
    // GDS (curated DataSet), GPL (Platform), GSM (Sample) have different
    // field layouts and are less useful for dataset discovery at this stage.
    if (record.entrytype && record.entrytype !== "GSE") return acc;

    // ── Accession ─────────────────────────────────────────────────────────
    const accession = record.accession?.trim();
    if (!accession) return acc; // skip records without a parseable accession

    // ── Platform ──────────────────────────────────────────────────────────
    // platformtitle is observed to be empty string in live API responses.
    // Fall back to GPL${gpl} which is always populated.
    const gplRaw = record.gpl != null ? String(record.gpl).trim() : "";
    const platform =
      record.platformtitle?.trim() ||
      (gplRaw ? `GPL${gplRaw}` : "Unknown platform");

    // ── Sample count ──────────────────────────────────────────────────────
    const rawSamples = record.n_samples;
    const sampleCount =
      rawSamples != null
        ? typeof rawSamples === "number"
          ? rawSamples
          : parseInt(String(rawSamples), 10) || undefined
        : undefined;

    // ── Publication date ──────────────────────────────────────────────────
    // ESummary pdat is "YYYY/MM/DD" — convert to ISO "YYYY-MM-DD"
    const publicationDate = record.pdat?.trim()
      ? record.pdat.trim().replace(/\//g, "-")
      : undefined;

    // ── PubMed IDs ────────────────────────────────────────────────────────
    const pubmedIds =
      Array.isArray(record.pubmedids) && record.pubmedids.length > 0
        ? record.pubmedids.map(String)
        : undefined;

    // ── Experiment type ───────────────────────────────────────────────────
    const experimentType = record.gdstype?.trim() || undefined;

    // ── Download URLs ─────────────────────────────────────────────────────
    // ftplink is returned by ESummary as ftp:// — convert to https:// for
    // browser-friendly access. All GSE datasets have matrix/, soft/, miniml/.
    // URL patterns verified HTTP 200 against real GSE accessions.
    let ftpDownloadUrl: string | undefined;
    let seriesMatrixUrl: string | undefined;
    let softFileUrl: string | undefined;
    let miniMLUrl: string | undefined;

    if (record.ftplink?.trim()) {
      const ftpBase = record.ftplink.trim().replace(/^ftp:\/\//, "https://");
      // Ensure trailing slash
      const base = ftpBase.endsWith("/") ? ftpBase : `${ftpBase}/`;
      ftpDownloadUrl = base;
      seriesMatrixUrl = `${base}matrix/${accession}_series_matrix.txt.gz`;
      softFileUrl = `${base}soft/${accession}_family.soft.gz`;
      miniMLUrl = `${base}miniml/${accession}_family.xml.tgz`;
    }

    const dataset: Dataset = {
      accession,
      title: record.title?.trim() || "Untitled dataset",
      organism: record.taxon?.trim() || "Unknown organism",
      platform,
      geoUrl: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
      ...(experimentType && { experimentType }),
      ...(sampleCount !== undefined && { sampleCount }),
      ...(publicationDate && { publicationDate }),
      ...(pubmedIds && { pubmedIds }),
      ...(record.summary?.trim() && { summary: record.summary.trim() }),
      ...(ftpDownloadUrl && { ftpDownloadUrl }),
      ...(seriesMatrixUrl && { seriesMatrixUrl }),
      ...(softFileUrl && { softFileUrl }),
      ...(miniMLUrl && { miniMLUrl }),
    };

    acc.push(dataset);
    return acc;
  }, []);
}
