/**
 * lib/protein/fetch.ts — NCBI data fetchers for the Protein Explorer (Phase 5.4A)
 *
 * Two public fetchers:
 *   fetchProteinSummaries(accessionVersions)
 *     Batch ESummary for all proteins in a gene (single NCBI call).
 *     NCBI protein ESummary accepts accession.version strings directly as `id`
 *     (confirmed with NP_000537.3 — returns UID 120407068 and full summary).
 *     No UID-resolution step is needed; the accession.version → UID mapping
 *     is handled internally by NCBI's ESummary endpoint.
 *
 *   fetchProteinDetail(accessionVersion)
 *     EFetch GenPept (rettype=gp) for a single protein — on-demand only.
 *
 * Rate limiting:
 *   Callers are responsible for scheduling GENE_RATE_DELAY_MS delays between
 *   calls. These functions do NOT insert delays internally.
 *
 * Entrez calls added by Phase 5.4A:
 *   Transcript list expand (all proteins in gene): +1 (batched ESummary)
 *   Protein sub-panel expand (one protein):        +1 (GenPept EFetch)
 *   FASTA download (one protein):                  +1 (FASTA EFetch)
 */

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function ncbiFetch(url: string, expectText = false): Promise<string | unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
    throw new Error(`HTTP ${res.status} from NCBI Protein API: ${url}`);
  }
  return expectText ? res.text() : res.json();
}

// ── ESummary response shapes ──────────────────────────────────────────────────

export interface ProteinSummaryEntry {
  uid: string;
  caption: string;           // unversioned accession, e.g. "NP_000537"
  title: string;             // protein name, e.g. "cellular tumor antigen p53 isoform a [Homo sapiens]"
  slen: number;              // sequence length in amino acids
  accessionversion: string;  // versioned accession, e.g. "NP_000537.3"
  sourcedb: string;          // "refseq" for RefSeq proteins
}

interface EsummaryProteinResponse {
  result: {
    uids: string[];
  } & Record<string, ProteinSummaryEntry>;
}

// ── Batch protein ESummary ────────────────────────────────────────────────────

/**
 * Fetch ESummary records for a batch of protein accession.version identifiers.
 *
 * NCBI ESummary (db=protein) accepts accession.version strings directly as the
 * `id` parameter — no prior ESearch/ELink UID-resolution step is required.
 * This was confirmed live: `id=NP_000537.3,NP_001394199.1` returns both entries
 * correctly in a single call.
 *
 * @param accessionVersions - Array of versioned protein accessions, e.g. ["NP_000537.3"]
 * @returns Map keyed by accessionversion → ProteinSummaryEntry, preserving input order.
 *          Entries absent from the response are omitted from the map.
 */
export async function fetchProteinSummaries(
  accessionVersions: string[]
): Promise<Map<string, ProteinSummaryEntry>> {
  if (accessionVersions.length === 0) return new Map();

  // Single batched ESummary call — NCBI handles accession.version → UID internally.
  const idParam = accessionVersions.join(",");
  const url =
    `${NCBI_BASE}/esummary.fcgi?db=protein` +
    `&id=${encodeURIComponent(idParam)}&retmode=json`;

  const response = (await ncbiFetch(url)) as EsummaryProteinResponse;
  const uids = response.result?.uids ?? [];

  // Build a map keyed by accessionversion for O(1) lookup by caller.
  const summaryMap = new Map<string, ProteinSummaryEntry>();
  for (const uid of uids) {
    const entry = response.result[uid];
    if (!entry || !entry.accessionversion) continue;
    summaryMap.set(entry.accessionversion, entry);
  }

  return summaryMap;
}

// ── Single-protein GenPept EFetch ─────────────────────────────────────────────

/**
 * Fetch the full GenPept record for a single protein accession.
 *
 * Called only on-demand when the user expands a specific protein sub-panel —
 * never during the batched summary call above.
 *
 * The returned text is the raw GenPept flat-file format, which the parser
 * in lib/protein/parser.ts processes to extract proteinName and molecularWeight.
 *
 * @param accessionVersion - Versioned protein accession, e.g. "NP_000537.3"
 */
export async function fetchProteinDetail(accessionVersion: string): Promise<string> {
  const url =
    `${NCBI_BASE}/efetch.fcgi?db=protein` +
    `&id=${encodeURIComponent(accessionVersion)}` +
    `&rettype=gp&retmode=text`;
  return ncbiFetch(url, true) as Promise<string>;
}

// ── Protein FASTA EFetch ──────────────────────────────────────────────────────

/**
 * Fetch the FASTA sequence for a single protein accession.
 *
 * Called only on-demand when the user clicks "Download FASTA" — never pre-fetched.
 * The server-side download route is responsible for rate-limit scheduling.
 *
 * @param accessionVersion - Versioned protein accession, e.g. "NP_000537.3"
 */
export async function fetchProteinFasta(accessionVersion: string): Promise<string> {
  const url =
    `${NCBI_BASE}/efetch.fcgi?db=protein` +
    `&id=${encodeURIComponent(accessionVersion)}` +
    `&rettype=fasta&retmode=text`;
  return ncbiFetch(url, true) as Promise<string>;
}
