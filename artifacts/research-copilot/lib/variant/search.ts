/**
 * lib/variant/search.ts — ClinVar ESearch/ESummary wrappers (Phase 5.5A)
 *
 * Provides thin wrappers over NCBI Entrez APIs for the ClinVar database.
 * Intentionally minimal: no business logic, no parsing — just raw NCBI responses.
 *
 * Rate limit: shares the NCBI 3 req/s budget with all other modules.
 * Sequential calls with 350ms delays via VARIANT_RATE_DELAY_MS.
 * All requests use fetchWithRetry (lib/utils.ts) for 429 backoff.
 *
 * Live API observations (2026-07-11):
 * - ESearch `[Gene ID]` works perfectly for variant retrieval by gene
 * - Filters: `"pathogenic"[clinical_significance]` and `"single nucleotide variant"[Variant Type]` work
 * - Sort: only `sort=relevance` produces a distinct ordering; `sort=clinical_significance` = default
 * - EFetch rettype=vcv returns empty XML — NOT usable; ESummary is the only viable batch path
 * - rsID lookup: `{digits}[RS]` returns ClinVar Variation IDs
 * - Variation ID lookup: `{id}[Variation ID]` returns the matching record
 */

import { fetchWithRetry } from "@/lib/utils";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Delay between NCBI calls to stay within 3 req/s limit. */
export const VARIANT_RATE_DELAY_MS = 350;

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Raw NCBI response shapes ──────────────────────────────────────────────────

export interface RawClinVarESearchResult {
  esearchresult: {
    count: string;
    retmax: string;
    retstart: string;
    idlist: string[];
    errorlist?: { phrasesnotfound?: string[]; fieldsnotfound?: string[] };
    warninglist?: { phrasesignored?: string[] };
  };
}

export interface RawClinVarVariationLoc {
  status: string;
  assembly_name: string;
  chr: string;
  start: string;
  stop: string;
  display_start: string;
  display_stop: string;
  band?: string;
  assembly_acc_ver?: string;
}

export interface RawClinVarVariationXref {
  db_source: string;
  db_id: string;
}

export interface RawClinVarVariationSet {
  measure_id?: string;
  variation_name?: string;
  cdna_change?: string;
  aliases?: string[];
  variation_loc?: RawClinVarVariationLoc[];
  allele_freq_set?: unknown[];
  variant_type?: string;
  canonical_spdi?: string;
  variation_xrefs?: RawClinVarVariationXref[];
  common_name?: string;
}

export interface RawClinVarGermlineClassification {
  description?: string;
  last_evaluated?: string;
  review_status?: string;
  fda_recognized_database?: string;
  trait_set?: {
    trait_name?: string;
    trait_xrefs?: { db_source: string; db_id: string }[];
  }[];
}

export interface RawClinVarGene {
  symbol: string;
  geneid: string;
  strand?: string;
  source?: string;
}

export interface RawClinVarESummaryEntry {
  uid: string;
  obj_type?: string;
  accession?: string;
  accession_version?: string;
  title?: string;
  variation_set?: RawClinVarVariationSet[];
  supporting_submissions?: {
    scv?: string[];
    rcv?: string[];
  };
  germline_classification?: RawClinVarGermlineClassification;
  clinical_impact_classification?: RawClinVarGermlineClassification;
  oncogenicity_classification?: RawClinVarGermlineClassification;
  record_status?: string;
  gene_sort?: string;
  chr_sort?: string;
  location_sort?: string;
  genes?: RawClinVarGene[];
  molecular_consequence_list?: string[];
  protein_change?: string;
  fda_recognized_database?: string;
}

export interface RawClinVarESummaryResult {
  result: {
    uids: string[];
    [uid: string]: unknown;
  };
}

// ── ESearch ───────────────────────────────────────────────────────────────────

/**
 * ClinVar ESearch by Gene ID.
 * Returns the list of ClinVar Variation IDs for a gene (paginated).
 *
 * @param geneId - NCBI Gene ID (numeric string, e.g. "7157")
 * @param retmax - Number of IDs to retrieve (default: 20, max: 500 for safety)
 * @param retstart - Zero-based offset (default: 0)
 * @param filter - Optional clinical significance or variant type filter
 * @param sort - Optional sort parameter ("relevance" or undefined for default)
 */
export async function clinvarESearchByGene(
  geneId: string,
  retmax = 20,
  retstart = 0,
  filter?: string | null,
  sort?: string | null
): Promise<RawClinVarESearchResult> {
  const baseTermParts = [`${geneId}[Gene ID]`];
  if (filter) baseTermParts.push(filter);
  const term = baseTermParts.join(" AND ");

  const params = new URLSearchParams({
    db: "clinvar",
    term,
    retmax: String(Math.min(retmax, 500)),
    retstart: String(retstart),
    retmode: "json",
  });
  if (sort && sort !== "default") params.set("sort", sort);

  const url = `${NCBI_BASE}/esearch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`ClinVar ESearch HTTP ${res.status}`);
  return (await res.json()) as RawClinVarESearchResult;
}

/**
 * ClinVar ESearch by rsID (dbSNP).
 * Returns ClinVar Variation IDs for the given rsID.
 *
 * @param rsDigits - rsID digits only (without "rs" prefix), e.g. "28934578"
 */
export async function clinvarESearchByRsId(
  rsDigits: string
): Promise<RawClinVarESearchResult> {
  const params = new URLSearchParams({
    db: "clinvar",
    term: `${rsDigits}[RS]`,
    retmax: "10",
    retmode: "json",
  });
  const url = `${NCBI_BASE}/esearch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`ClinVar ESearch (rsID) HTTP ${res.status}`);
  return (await res.json()) as RawClinVarESearchResult;
}

/**
 * ClinVar ESearch by Variation ID (numeric ClinVar ID).
 * Used to verify a known Variation ID and retrieve its ESummary data.
 *
 * @param variationId - Numeric ClinVar Variation ID (string), e.g. "12375"
 */
export async function clinvarESearchByVariationId(
  variationId: string
): Promise<RawClinVarESearchResult> {
  const params = new URLSearchParams({
    db: "clinvar",
    term: `${variationId}[Variation ID]`,
    retmax: "1",
    retmode: "json",
  });
  const url = `${NCBI_BASE}/esearch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`ClinVar ESearch (VarID) HTTP ${res.status}`);
  return (await res.json()) as RawClinVarESearchResult;
}

/**
 * ClinVar ESearch to retrieve total count only.
 * Uses retmax=0 — no IDs returned, just the count. Efficient for pagination metadata.
 *
 * @param geneId - NCBI Gene ID (numeric string)
 * @param filter - Optional clinical significance or variant type filter
 */
export async function clinvarCountByGene(
  geneId: string,
  filter?: string | null
): Promise<number> {
  const termParts = [`${geneId}[Gene ID]`];
  if (filter) termParts.push(filter);
  const term = termParts.join(" AND ");

  const params = new URLSearchParams({
    db: "clinvar",
    term,
    retmax: "0",
    retmode: "json",
  });
  const url = `${NCBI_BASE}/esearch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`ClinVar ESearch (count) HTTP ${res.status}`);
  const data = (await res.json()) as RawClinVarESearchResult;
  return parseInt(data.esearchresult.count, 10) || 0;
}

// ── ESummary ──────────────────────────────────────────────────────────────────

/**
 * ClinVar ESummary for a batch of Variation IDs.
 * Returns a map from uid to ESummary entry.
 *
 * @param ids - ClinVar Variation IDs (numeric strings). Max 100 per batch recommended.
 */
export async function clinvarESummary(
  ids: string[]
): Promise<Map<string, RawClinVarESummaryEntry>> {
  if (ids.length === 0) return new Map();

  const params = new URLSearchParams({
    db: "clinvar",
    id: ids.join(","),
    retmode: "json",
  });
  const url = `${NCBI_BASE}/esummary.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`ClinVar ESummary HTTP ${res.status}`);

  const data = (await res.json()) as RawClinVarESummaryResult;
  const result = data.result ?? {};
  const uids: string[] = Array.isArray(result.uids)
    ? (result.uids as string[])
    : ids;

  const map = new Map<string, RawClinVarESummaryEntry>();
  for (const uid of uids) {
    const entry = result[uid];
    if (entry && typeof entry === "object") {
      map.set(uid, entry as RawClinVarESummaryEntry);
    }
  }
  return map;
}
