/**
 * lib/gene/search.ts — NCBI Gene ESearch utilities (Phase 5.2)
 *
 * Provides ESearch against db=gene for the Gene Explorer module.
 * Used when the resolver does NOT supply a direct Gene ID (MEDIUM/LOW confidence
 * or queryType !== "Gene"). HIGH-confidence gene queries skip ESearch entirely
 * and go direct to ESummary via the Gene ID from the resolver.
 *
 * Rate limit: shares the NCBI 3 req/s budget with PubMed, GEO, and Sequence Foundation.
 * The Gene Explorer is called sequentially after other modules in the API route.
 * Internal calls within the gene module use 350ms delays between NCBI requests.
 */

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Delay between NCBI calls to stay within 3 req/s. */
export const GENE_RATE_DELAY_MS = 350;

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Raw NCBI response shapes ──────────────────────────────────────────────────

export interface RawGeneESearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
  };
}

export interface RawGeneESummaryEntry {
  uid: string;
  name: string;
  description: string;
  status: string;
  currentid?: string;
  chromosome: string;
  geneticsource?: string;
  maplocation: string;
  otheraliases?: string;
  otherdesignations?: string;
  nomenclaturesymbol?: string;
  nomenclaturename?: string;
  nomenclaturestatus?: string;
  mim?: string[];
  genomicinfo?: Array<{
    chrloc: string;
    chraccver: string;
    chrstart: number;
    chrstop: number;
    exoncount: number;
  }>;
  geneweight?: number;
  summary?: string;
  organism: {
    scientificname: string;
    commonname?: string;
    taxid: number;
  };
}

export interface RawGeneESummaryResult {
  result: { uids: string[] } & Record<string, RawGeneESummaryEntry>;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function ncbiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
    throw new Error(`HTTP ${res.status} from NCBI Gene API: ${url}`);
  }
  return res.json() as Promise<T>;
}

// ── ESearch ───────────────────────────────────────────────────────────────────

/**
 * ESearch against db=gene.
 *
 * @param term  Full ESearch query string (e.g. "TP53[sym] AND Homo sapiens[orgn]")
 * @param retmax  Maximum number of IDs to return. Default: 10.
 * @returns { count, ids }
 */
export async function geneESearch(
  term: string,
  retmax = 10
): Promise<{ count: number; ids: string[] }> {
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=gene` +
    `&term=${encodeURIComponent(term)}&retmax=${retmax}&retmode=json`;
  const data = await ncbiFetch<RawGeneESearchResult>(url);
  const count = parseInt(data.esearchresult.count, 10) || 0;
  return { count, ids: data.esearchresult.idlist ?? [] };
}

// ── ESummary ──────────────────────────────────────────────────────────────────

/**
 * ESummary for one or more gene IDs.
 * Filters out discontinued genes (status === "discontinued").
 *
 * @param ids  Array of NCBI Gene IDs (numeric strings).
 * @returns  Array of raw ESummary entries.
 */
export async function geneESummary(
  ids: string[]
): Promise<RawGeneESummaryEntry[]> {
  if (ids.length === 0) return [];
  const url =
    `${NCBI_BASE}/esummary.fcgi?db=gene` +
    `&id=${ids.slice(0, 10).join(",")}&retmode=json`;
  const data = await ncbiFetch<RawGeneESummaryResult>(url);
  const uids = data.result.uids ?? [];
  return uids
    .map((uid) => data.result[uid])
    .filter(
      (e): e is RawGeneESummaryEntry =>
        Boolean(e) && typeof e === "object" && e.status !== "discontinued"
    );
}

// ── ESearch term builders ─────────────────────────────────────────────────────

/**
 * Build an ESearch term for a gene symbol search in Homo sapiens.
 * Used for HIGH-symbol queries and MEDIUM tier when resolver identified Homo sapiens.
 */
export function humanGeneSearchTerm(symbol: string): string {
  return `${symbol.toUpperCase()}[sym] AND Homo sapiens[orgn]`;
}

/**
 * Build an ESearch term for a gene symbol search across all organisms.
 * Used when organism is unknown or query returned no human hit.
 */
export function broadGeneSearchTerm(symbol: string): string {
  return `${symbol.toUpperCase()}[sym]`;
}

/**
 * Build an ESearch term for a free-text query (disease+gene combos, multi-word queries).
 * Used as fallback when the query doesn't match the gene symbol pattern.
 */
export function freeTextGeneSearchTerm(query: string): string {
  return query;
}

export { NCBI_BASE };
