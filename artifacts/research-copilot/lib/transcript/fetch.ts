/**
 * lib/transcript/fetch.ts — NCBI data fetchers for the Transcript Explorer (Phase 5.3A)
 *
 * Two fetchers:
 *   1. fetchGeneTable(geneId)    → raw gene_table text (transcript list)
 *   2. fetchManeInfo(geneId)     → MANE Select + MANE Plus Clinical accession sets
 *
 * fetchGeneTable uses:
 *   efetch.fcgi?db=gene&id={geneId}&rettype=gene_table&retmode=text
 *   This is a NEW Entrez call not made by Phase 5.2 (Phase 5.2 uses ESummary, not EFetch).
 *   Typical response: ~450 lines for human TP53 (26 transcripts), ~100 lines for mouse Trp53.
 *
 * fetchManeInfo uses (human genes only):
 *   esearch.fcgi?db=nuccore&term={geneId}[gene_id] AND MANE Select[Keyword]
 *   esearch.fcgi?db=nuccore&term={geneId}[gene_id] AND MANE Plus Clinical[Keyword]
 *   esummary.fcgi?db=nuccore&id={combined_ids}
 *   Returns sets of RefSeq (NM_/NR_) accession versions, filtered from ENST results.
 *
 * Rate limit: callers must insert 350ms delays between NCBI calls.
 * These fetchers do NOT include delays internally — delay scheduling is in index.ts.
 *
 * Entrez call count added by Phase 5.3A:
 *   Non-human genes: +1 (gene_table only)
 *   Human genes:     +4 (gene_table + MANE Select ESearch + MANE Plus Clinical ESearch
 *                        + combined nuccore ESummary)
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
    throw new Error(`HTTP ${res.status} from NCBI Transcript API: ${url}`);
  }
  return expectText ? res.text() : res.json();
}

// ── Gene table EFetch ─────────────────────────────────────────────────────────

/**
 * Fetch the gene_table text for a given NCBI Gene ID.
 *
 * The gene_table format contains one line per transcript:
 *   mRNA transcript variant 1 NM_000546.6, 11 exons,  total annotated spliced exon length: 2512
 *   RNA transcript variant 14 NR_176326.1, 10 exons,  total annotated spliced exon length: 2399
 *   mRNA transcript variant X2 XM_030245922.1, 12 exons,  total annotated spliced exon length: 1881
 *
 * The gene_table also includes exon tables per transcript (ignored in Phase 5.3A)
 * and protein lines (ignored — protein linkage is Phase 5.4).
 *
 * Note: This is a NEW Entrez call (not present in Phase 5.2).
 * The EFetch XML (rettype=xml) was considered but rejected because:
 *   - TP53 XML EFetch is 33MB — too large per query
 *   - MANE Select data is more efficiently retrieved via nuccore ESearch (see fetchManeInfo)
 *   - gene_table gives all transcript metadata in a compact, parseable text format
 */
export async function fetchGeneTable(geneId: string): Promise<string> {
  const url =
    `${NCBI_BASE}/efetch.fcgi?db=gene` +
    `&id=${encodeURIComponent(geneId)}` +
    `&rettype=gene_table&retmode=text`;
  return ncbiFetch(url, true) as Promise<string>;
}

// ── MANE info (human genes only) ─────────────────────────────────────────────

export interface ManeInfo {
  /** MANE Select RefSeq accession versions (NM_ only). E.g. ["NM_000546.6"]. */
  maneSelectAccessions: string[];
  /** MANE Plus Clinical RefSeq accession versions (NM_ only). */
  manePlusClinicalAccessions: string[];
}

/**
 * Fetch MANE Select and MANE Plus Clinical accessions for a human gene.
 *
 * Algorithm:
 *   1. ESearch nuccore for "{geneId}[gene_id] AND MANE Select[Keyword]" → select UIDs
 *   2. ESearch nuccore for "{geneId}[gene_id] AND MANE Plus Clinical[Keyword]" → plus_clinical UIDs
 *   3. Combine UIDs (deduplicated), ESummary to get accessionversion for each
 *   4. Filter for NM_/NR_ prefix (exclude ENST Ensembl accessions returned by NCBI)
 *   5. Classify each by which ESearch set it came from
 *
 * Only call for human (taxid 9606) genes — MANE does not apply to non-human organisms.
 * Callers are responsible for inserting rate-limit delays between calls.
 *
 * Returns empty arrays if no MANE transcripts found or if any step fails.
 * Errors are propagated to the caller (index.ts) for graceful degradation.
 */
export async function fetchManeInfo(
  geneId: string,
  sleepFn: (ms: number) => Promise<void>,
  delayMs: number
): Promise<ManeInfo> {
  // ── Step 1: ESearch for MANE Select ─────────────────────────────────────────
  const selectUrl =
    `${NCBI_BASE}/esearch.fcgi?db=nuccore` +
    `&term=${encodeURIComponent(`${geneId}[gene_id] AND MANE Select[Keyword]`)}` +
    `&retmax=10&retmode=json`;
  const selectResult = await ncbiFetch(selectUrl) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const selectIds = new Set(selectResult.esearchresult.idlist ?? []);

  // ── Step 2: ESearch for MANE Plus Clinical ───────────────────────────────────
  await sleepFn(delayMs);
  const plusUrl =
    `${NCBI_BASE}/esearch.fcgi?db=nuccore` +
    `&term=${encodeURIComponent(`${geneId}[gene_id] AND MANE Plus Clinical[Keyword]`)}` +
    `&retmax=10&retmode=json`;
  const plusResult = await ncbiFetch(plusUrl) as {
    esearchresult: { count: string; idlist: string[] };
  };
  const plusIds = new Set(plusResult.esearchresult.idlist ?? []);

  // Early exit — no MANE data at all
  if (selectIds.size === 0 && plusIds.size === 0) {
    return { maneSelectAccessions: [], manePlusClinicalAccessions: [] };
  }

  // ── Step 3: Combined ESummary for all MANE UIDs ──────────────────────────────
  const allIds = Array.from(new Set([...selectIds, ...plusIds]));
  await sleepFn(delayMs);
  const summaryUrl =
    `${NCBI_BASE}/esummary.fcgi?db=nuccore` +
    `&id=${allIds.slice(0, 20).join(",")}&retmode=json`;
  const summaryResult = await ncbiFetch(summaryUrl) as {
    result: { uids: string[] } & Record<string, { accessionversion?: string }>;
  };
  const summaryUids = summaryResult.result.uids ?? [];

  // ── Step 4+5: Filter for RefSeq (NM_/NR_) and classify ──────────────────────
  const maneSelectAccessions: string[] = [];
  const manePlusClinicalAccessions: string[] = [];

  for (const uid of summaryUids) {
    const entry = summaryResult.result[uid];
    const accVer = entry?.accessionversion ?? "";
    // Only keep RefSeq transcript accessions (not Ensembl ENST)
    if (!accVer.match(/^(NM_|NR_|XM_|XR_)/)) continue;
    if (selectIds.has(uid)) maneSelectAccessions.push(accVer);
    if (plusIds.has(uid)) manePlusClinicalAccessions.push(accVer);
  }

  return { maneSelectAccessions, manePlusClinicalAccessions };
}
