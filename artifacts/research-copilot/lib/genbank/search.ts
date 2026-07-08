/**
 * genbank/search.ts — Query classification and NCBI database routing.
 *
 * Applies Rules 1, 2, 3 from the Phase 5.1 spec:
 *
 *   Rule 1 — Accession queries: resolve directly, surface RefSeq if GenBank given.
 *   Rule 2 — Organism queries: assembly db, sort by refseq_category (reference > representative).
 *   Rule 3 — Gene-symbol queries: gene db → NG_ (RefSeqGene) record via elink.
 *
 * Database selection decisions (from pre-code live API inspection):
 *
 *   Gene symbols (TP53, BRCA1):
 *     → gene db for metadata + gene_id
 *     → nuccore db for the NG_ RefSeqGene record (via elink gene→nuccore refseqgene)
 *
 *   Organisms (Mycobacterium tuberculosis H37Rv, Arabidopsis thaliana):
 *     → assembly db: provides refseq_category ("reference genome" / "representative genome")
 *       and ftppath_refseq for verified download URLs
 *     → Fallback to nuccore when assembly db finds no reference/representative genome
 *       (observed for SARS-CoV-2 which has 12,472 individual isolate assemblies, none
 *       flagged as reference genome via assembly db — NC_045512.2 is accessed via nuccore)
 *
 *   Accessions (NC_045512, GCF_000195955.2):
 *     → direct nuccore or assembly lookup
 *
 * NCBI ESearch ceiling: NOT relevant for sequence queries, which return ≤5 curated results.
 * WebEnv/QueryKey: not needed for this module (sequence discovery, not bulk enumeration).
 */

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Delay between sequential NCBI calls to stay within 3 req/s rate limit */
const RATE_DELAY_MS = 350;

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

// ── NCBI accession pattern ────────────────────────────────────────────────────
// Recognises: NC_, NG_, NM_, NR_, NP_, NT_, NW_, XM_, XP_, XR_
//             GCF_, GCA_   (assembly accessions)
//             2–4 letter INSDC prefixes followed by digits (AY, MK, OX, CP…)
const ACCESSION_RE =
  /^(NC|NG|NM|NR|NP|NT|NW|XM|XP|XR|GCF|GCA|[A-Z]{2}|[A-Z]{4})_?\d{6,}(\.\d+)?$/i;

// ── Gene symbol pattern ───────────────────────────────────────────────────────
// All-uppercase, 2–13 chars, may end with a digit (TP53, BRCA1, EGFR, KRAS…).
// Must NOT match organism names (multi-word), common-name queries (SARS-CoV-2), or accessions.
// Excludes strings with hyphens, spaces, or lowercase letters.
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,12}$/;

export type QueryType = "gene-symbol" | "accession" | "organism";

export function classifyQuery(query: string): QueryType {
  const trimmed = query.trim();
  // Accession regex has /i flag — already case-insensitive.
  if (ACCESSION_RE.test(trimmed)) return "accession";
  // Gene-symbol regex requires all-uppercase, so it handles "TP53" directly.
  if (GENE_SYMBOL_RE.test(trimmed)) return "gene-symbol";
  // Allow lowercase/mixed-case gene symbols that contain at least one digit
  // (e.g. "tp53", "brca1", "Trp53").  Pure-alphabetic lowercase words such as
  // "mouse" or "arabidopsis" are intentionally left as "organism" to prevent
  // misrouting common organism names when the biological resolver returns a
  // LOW-confidence or Unknown result and passes the raw lowercase string here.
  const lc = trimmed.toLowerCase();
  if (/\d/.test(lc) && GENE_SYMBOL_RE.test(lc.toUpperCase())) return "gene-symbol";
  return "organism";
}

// ── Raw NCBI response shapes ──────────────────────────────────────────────────

export interface GeneESummaryEntry {
  uid: string;
  name: string;
  description: string;
  status: string;
  chromosome: string;
  maplocation: string;
  organism: { scientificname: string; taxid: number };
  genomicinfo: Array<{
    chrloc: string;
    chraccver: string;
    chrstart: number;
    chrstop: number;
    exoncount: number;
  }>;
  summary: string;
}

export interface AssemblyESummaryEntry {
  uid: string;
  assemblyaccession: string;
  assemblyname: string;
  assemblystatus: string;
  refseq_category: string;
  organism: string;
  speciesname: string;
  taxid: string;
  ftppath_refseq: string;
  ftppath_genbank: string;
  synonym: { genbank?: string; refseq?: string; similarity?: string };
  contign50: number;
  scaffoldn50: number;
  asmreleasedate_genbank: string;
  lastupdatedate: string;
  meta: string;
}

export interface NucCoreESummaryEntry {
  uid: string;
  accessionversion: string;
  title: string;
  slen: string;
  moltype: string;
  topology: string;
  sourcedb: string;
  organism: string;
  taxid: string;
  createdate: string;
  updatedate: string;
  biomol: string;
  genome: string;
  completeness: string;
  assemblyacc: string;
  assemblygi: string;
}

// ── Shared fetch helper ───────────────────────────────────────────────────────

/**
 * Fetch a NCBI Entrez URL and return the parsed JSON.
 *
 * Retries up to `maxRetries` times on HTTP 429 (rate limit) with a 2-second
 * backoff. NCBI allows 3 req/s without an API key; 429 can occur during the
 * initial page load when PubMed, GEO, and Sequence all run sequentially but
 * close together. A 2-second backoff is enough to clear the rate window.
 */
async function ncbiFetch(url: string, maxRetries = 2): Promise<unknown> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential-ish backoff: 2s, 4s
      await sleep(2000 * attempt);
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "ResearchCoPilot/1.0 (research tool; contact: admin@example.com)",
      },
    });
    if (res.status === 429) {
      lastError = new Error(`NCBI HTTP 429 for ${url}`);
      continue; // retry after backoff
    }
    if (!res.ok) {
      throw new Error(`NCBI HTTP ${res.status} for ${url}`);
    }
    return res.json();
  }
  throw lastError ?? new Error(`NCBI fetch failed after ${maxRetries} retries`);
}

// ── Gene ESearch ──────────────────────────────────────────────────────────────

export interface GeneSearchResult {
  geneId: string;
  totalCount: number;
}

/**
 * Search the NCBI Gene database for a gene symbol.
 * Returns the top gene ID and total hit count.
 * Throws on HTTP error or zero results (let callers decide the fallback).
 */
export async function searchGene(geneSymbol: string): Promise<GeneSearchResult> {
  // Search human first (most gene-symbol queries refer to human genes)
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=gene` +
    `&term=${encodeURIComponent(geneSymbol)}[Gene+Name]+AND+Homo+sapiens[Organism]` +
    `&retmax=1&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const result = data.esearchresult;
  const totalCount = parseInt(result.count, 10) || 0;

  if (result.idlist.length > 0) {
    return { geneId: result.idlist[0], totalCount };
  }

  // Fallback: search without organism filter (gene exists in non-human organisms)
  await sleep(RATE_DELAY_MS);
  const urlNoOrg =
    `${NCBI_BASE}/esearch.fcgi?db=gene` +
    `&term=${encodeURIComponent(geneSymbol)}[Gene+Name]` +
    `&retmax=1&retmode=json`;
  const data2 = (await ncbiFetch(urlNoOrg)) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const r2 = data2.esearchresult;
  if (r2.idlist.length === 0) {
    throw new Error(`No gene found for symbol "${geneSymbol}"`);
  }
  return { geneId: r2.idlist[0], totalCount: parseInt(r2.count, 10) || 0 };
}

// ── Gene ESummary ─────────────────────────────────────────────────────────────

export async function fetchGeneSummary(geneId: string): Promise<GeneESummaryEntry> {
  const url =
    `${NCBI_BASE}/esummary.fcgi?db=gene&id=${encodeURIComponent(geneId)}&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    result: Record<string, GeneESummaryEntry>;
  };
  const entry = data.result[geneId];
  if (!entry) throw new Error(`Gene ESummary returned no entry for gene_id=${geneId}`);
  return entry;
}

// ── Gene → RefSeqGene elink ───────────────────────────────────────────────────

export interface ElinkResult {
  nuccoreIds: string[];
}

/**
 * Use NCBI elink to get the RefSeqGene nuccore record(s) for a given gene ID.
 * linkname=gene_nuccore_refseqgene returns NG_ records linked to the gene.
 */
export async function getRefSeqGeneNuccoreIds(geneId: string): Promise<ElinkResult> {
  const url =
    `${NCBI_BASE}/elink.fcgi?dbfrom=gene&db=nuccore` +
    `&id=${encodeURIComponent(geneId)}&linkname=gene_nuccore_refseqgene&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    linksets?: Array<{
      linksetdbs?: Array<{ links?: string[] }>;
    }>;
  };

  const linksets = data.linksets ?? [];
  for (const ls of linksets) {
    const dbs = ls.linksetdbs ?? [];
    for (const db of dbs) {
      if ((db.links ?? []).length > 0) {
        return { nuccoreIds: db.links as string[] };
      }
    }
  }
  return { nuccoreIds: [] };
}

// ── Assembly ESearch ──────────────────────────────────────────────────────────

export interface AssemblySearchResult {
  ids: string[];
  totalCount: number;
}

/**
 * Search the NCBI Assembly database for an organism name.
 *
 * Rule 2 implementation detail: NCBI's default ESearch sort is newest-first,
 * so the "reference genome" assembly may NOT be in the top results for organisms
 * with many assemblies (e.g. Arabidopsis thaliana has 378 assemblies and the
 * reference genome UID 1733481 is near position 375). We therefore fetch up to
 * maxIds results and apply refseq_category sorting in code (see parseAssemblyBatch
 * in summary.ts) rather than relying on NCBI's ordering.
 */
export async function searchAssemblies(
  organism: string,
  maxIds = 200
): Promise<AssemblySearchResult> {
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=assembly` +
    `&term=${encodeURIComponent(organism)}[Organism]` +
    `&retmax=${maxIds}&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const r = data.esearchresult;
  return {
    ids: r.idlist,
    totalCount: parseInt(r.count, 10) || 0,
  };
}

// ── Assembly ESummary batch ───────────────────────────────────────────────────

/**
 * Fetch assembly ESummary entries in batches of 50 to avoid URL-length limits
 * and reduce 429 exposure when many IDs are requested in rapid succession.
 *
 * NCBI supports large ID lists in GET requests but batching keeps each request
 * short and inserts the standard RATE_DELAY_MS pause between chunks.
 */
export async function fetchAssemblySummaries(
  ids: string[]
): Promise<AssemblyESummaryEntry[]> {
  if (ids.length === 0) return [];

  const CHUNK_SIZE = 50;
  const results: AssemblyESummaryEntry[] = [];

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const url =
      `${NCBI_BASE}/esummary.fcgi?db=assembly` +
      `&id=${chunk.join(",")}&retmode=json`;
    const data = (await ncbiFetch(url)) as {
      result: { uids: string[] } & Record<string, AssemblyESummaryEntry>;
    };
    const uids = data.result.uids ?? [];
    results.push(...uids.map((uid) => data.result[uid]).filter(Boolean));
    // Delay between chunks — skip after the last chunk
    if (i + CHUNK_SIZE < ids.length) {
      await sleep(RATE_DELAY_MS);
    }
  }

  return results;
}

// ── NucCore ESummary ──────────────────────────────────────────────────────────

export async function fetchNucCoreSummaries(
  ids: string[]
): Promise<NucCoreESummaryEntry[]> {
  if (ids.length === 0) return [];
  const url =
    `${NCBI_BASE}/esummary.fcgi?db=nuccore` +
    `&id=${ids.join(",")}&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    result: { uids: string[] } & Record<string, NucCoreESummaryEntry>;
  };
  const uids = data.result.uids ?? [];
  return uids.map((uid) => data.result[uid]).filter(Boolean);
}

// ── NucCore ESearch (organism fallback + accession lookup) ───────────────────

export interface NucCoreSearchResult {
  ids: string[];
  totalCount: number;
}

/**
 * Fallback nuccore search for viruses/organisms that have no curated assembly
 * with reference/representative status in NCBI Assembly db.
 *
 * Observed for: SARS-CoV-2 (12,472 individual isolate assemblies in Assembly db,
 * all GCA_ / refseq_category="na"; the reference is NC_045512.2 in nuccore).
 */
export async function searchNucCoreRefSeq(
  organism: string
): Promise<NucCoreSearchResult> {
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=nuccore` +
    `&term=${encodeURIComponent(organism)}[Organism]` +
    `+AND+RefSeq[Filter]` +
    `+AND+complete+genome[Title]` +
    `&retmax=5&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const r = data.esearchresult;
  return {
    ids: r.idlist,
    totalCount: parseInt(r.count, 10) || 0,
  };
}

/**
 * Direct accession lookup in nuccore.
 */
export async function searchNucCoreByAccession(
  accession: string
): Promise<NucCoreSearchResult> {
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=nuccore` +
    `&term=${encodeURIComponent(accession)}[Accession]&retmax=3&retmode=json`;
  const data = (await ncbiFetch(url)) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const r = data.esearchresult;
  return {
    ids: r.idlist,
    totalCount: parseInt(r.count, 10) || 0,
  };
}

export { sleep, RATE_DELAY_MS, NCBI_BASE };
