/**
 * lib/clinical-evidence/clinvar-retrieval.ts — ClinVar VCV EFetch wrapper (Phase 5.5B-1)
 *
 * Retrieves the full VCV XML for a single ClinVar variation, which contains:
 *   - VariationArchive attributes: NumberOfSubmissions, NumberOfSubmitters
 *   - ClassifiedRecord / RCVList: per-condition interpretations (RCVs)
 *   - ClassifiedRecord / ClinicalAssertionList: individual submissions (SCVs)
 *
 * AUDIT FINDINGS (confirmed 2026-07-18):
 *   - Surface: efetch.fcgi?db=clinvar&rettype=vcv&id=VCV{accession}&retmode=xml
 *   - REQUIRED: ID must be in VCV-prefixed format (e.g. "VCV004685939")
 *     Numeric-only IDs return empty <set/> — NOT usable
 *   - retmode=json silently returns XML — NO JSON mode exists for this endpoint
 *   - RCV ESummary: "Invalid uid" for RCV accessions — NOT queryable via ESummary
 *   - Dedicated ClinVar REST API (api.ncbi.nlm.nih.gov/clinvar/...): 404 — not live
 *   - Bulk FTP files: not suitable for per-request on-demand retrieval (documented)
 *
 * RATE LIMIT: Reuses VARIANT_RATE_DELAY_MS (350ms) and fetchWithRetry from lib/utils.
 * Clinical evidence fetch is triggered only on explicit variant selection — never
 * called for every variant in the list (one call per selected variant).
 */

import { fetchWithRetry } from "@/lib/utils";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Fetch the full ClinVar VCV XML for a given variation.
 *
 * @param vcvAccession - VCV-prefixed accession string, e.g. "VCV004685939"
 *   If clinvarAccession is null, construct from clinvarVariationId with zero-padding.
 * @returns Raw XML string, or throws on HTTP/network error.
 */
export async function fetchClinVarVCVXml(vcvAccession: string): Promise<string> {
  // Validate the prefix — must start with VCV
  if (!vcvAccession.startsWith("VCV")) {
    throw new Error(
      `fetchClinVarVCVXml: id must be VCV-prefixed (got: "${vcvAccession}"). ` +
      "Numeric-only IDs return empty XML from ClinVar EFetch."
    );
  }

  const params = new URLSearchParams({
    db: "clinvar",
    rettype: "vcv",
    id: vcvAccession,
    retmode: "xml",
  });

  const url = `${NCBI_BASE}/efetch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`ClinVar VCV EFetch HTTP ${res.status} for ${vcvAccession}`);
  }

  const xml = await res.text();

  // Detect the empty-set response (returned when numeric-only ID is used)
  if (xml.includes("<set/>")) {
    throw new Error(
      `ClinVar VCV EFetch returned empty <set/> for "${vcvAccession}". ` +
      "This typically means the ID is numeric-only; the VCV prefix is required."
    );
  }

  return xml;
}

/**
 * Construct a VCV-prefixed accession from a numeric clinvarVariationId.
 * ClinVar uses 9-digit zero-padded format (e.g. "VCV000004685939" = 12 chars,
 * but observed from ESummary: "VCV004685939" = 9-digit padding).
 *
 * @param clinvarAccession - Already-formatted VCV accession (preferred path)
 * @param clinvarVariationId - Numeric variation ID string (fallback)
 */
export function buildVcvAccession(
  clinvarAccession: string | null,
  clinvarVariationId: string
): string {
  if (clinvarAccession && clinvarAccession.startsWith("VCV")) {
    return clinvarAccession;
  }
  // Fallback: zero-pad to 9 digits (matching ESummary's observed format)
  return `VCV${clinvarVariationId.padStart(9, "0")}`;
}
