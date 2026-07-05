# PHASE 5.3C FINAL REPORT — Transcript Explorer Hardening Complete

Generated: 2026-07-05

This document is the entry point for Phase 5.4 (Protein Explorer). It assumes
no prior conversation context.

---

## 1. Summary

Phase 5.3C (both Part 1 and this closing session) is **verification-only**.
No source files were modified. `PHASE-5.3C-PART1-REPORT.md` (already in the
repo root, dated 2026-07-04) completed Steps 1–4 of the hardening plan
(full chain verification, Entrez audit, MANE verification, protein linkage
verification) and found exactly one bug — already fixed in Phase 5.3B Part 2,
before Part 1 began. This session re-verified UI consistency, ran targeted
regressions live against the running app, and confirmed every item on the
Pre-5.4 readiness checklist. **No new bugs were found. No code was changed.**

TypeScript: **0 errors**. No Python files touched. No AI-generated sections
touched.

---

## 2. Complete File Structure (Phase 5.3A → 5.3C)

All paths are relative to `artifacts/research-copilot/`.

| File | Introduced | Purpose |
|---|---|---|
| `types/transcript-record.ts` | 5.3A | `TranscriptRecord` interface + derivation helpers (`transcriptTypeFromAccession`, `accessionPrefixFromAccession`, `isProteinCodingFromAccession`, `refseqStatusFromAccession`, `sortTranscripts`) |
| `lib/transcript/fetch.ts` | 5.3A (gene_table, MANE) / 5.3B (sequence fetch) | NCBI fetchers: `fetchGeneTable`, `fetchManeInfo`, `fetchTranscriptSequence` |
| `lib/transcript/parser.ts` | 5.3A (transcripts) / 5.3C-Part1 (protein lines, MANE post-fix) | Parses gene_table text into `TranscriptRecord[]`; extracts protein isoform lines; corrects `maneSelectAccession` via isCanonical post-processing |
| `lib/transcript/index.ts` | 5.3A | `searchTranscripts()` orchestrator — module entry point, caching, error semantics |
| `types/gene-record.ts` | 5.2 (base) / 5.3A (transcripts expansion) | `GeneRecord.transcripts` expanded from availability stub to `{available, count, records, maneSelectPresent}` |
| `app/api/analyze/route.ts` | 5.2 (base) / 5.3A (transcript wiring, lines ~362–392) | Calls `searchTranscripts()` for the primary resolved gene only; merges result into `genes[0].transcripts` |
| `app/api/transcript/download/route.ts` | 5.3B Part 1 | FASTA/CDS download proxy; accession validation; NR_/XR_ CDS rejection; server-side rate limiter |
| `app/api/transcript/summary/route.ts` | 5.3B Part 2 | Lazy per-transcript RefSeq summary (GenBank COMMENT "Transcript Variant:" paragraph), rate-limited |
| `components/GeneExplorerSection.tsx` | 5.2 (base card) / 5.3A–5.3B (Transcript Explorer subsection, `TranscriptRow`, `DownloadButton`, accordion, pagination) | UI: `TranscriptExplorer`, `TranscriptRow`, `DetailField`, `DownloadButton`, `ResourceBadge` |

No files were added, removed, or modified in this closing 5.3C session.

---

## 3. Protein Linkage Status

Exact values confirmed live (re-verified this session for TP53 via `/api/analyze`):

| accessionVersion | proteinAccession | proteinAccessionVersion | Needs Phase 5.4 ELink? |
|---|---|---|---|
| NM_000546.6 (TP53) | NP_000537 | NP_000537.3 | No — populated directly |
| NM_001407270.1 (TP53) | NP_001394199 | NP_001394199.1 | No — populated directly |
| NM_001407271.1 (TP53) | NP_001394200 | NP_001394200.1 | No — populated directly |
| NM_001267550.2 (TTN) | NP_001254479 | (populated) | No — populated directly |
| XM_017004819.1 (TTN) | XP_016860308 | (populated) | No — populated directly |
| NM_001127233.1 (mouse Trp53) | NP_001120705 | NP_001120705.1 | No — populated directly |
| NR_176326.1 (TP53) | null | null | No ELink needed — non-coding, no protein by definition |

**Retrieval strategy for Phase 5.4:** `proteinAccession` / `proteinAccessionVersion`
are populated directly from the gene_table "protein isoform" line parsed
immediately after each NM_/XM_ transcript line (`lib/transcript/parser.ts`,
`PROTEIN_LINE_RE`). No ELink call was needed for any transcript tested across
4 genes (TP53, BRCA1, TTN, mouse Trp53). The fallback path —
`// TODO Phase 5.4: fetch protein accession via ELink db=gene→db=protein`
(`lib/transcript/parser.ts` line 131) — exists for the edge case where a
coding transcript's protein line is absent from the gene_table response, but
this edge case has not been observed. Phase 5.4 should check
`proteinAccession !== null` first and only fall back to ELink when null.

---

## 4. Entrez Call Map (full TP53 session)

| # | Module | Endpoint | DB | Trigger |
|---|---|---|---|---|
| 1 | Resolver | ESearch | gene | Page load |
| 2 | Gene Explorer | ESummary | gene | Page load |
| 3 | Gene Explorer | ELink | gene→pubmed | Page load |
| 4 | Transcript Explorer | EFetch (gene_table) | gene | Page load |
| 5 | Transcript Explorer | ESearch (MANE Select) | nuccore | Page load, human only |
| 6 | Transcript Explorer | ESearch (MANE Plus Clinical) | nuccore | Page load, human only |
| 7 | Transcript Explorer | ESummary | nuccore | Page load, human only |
| 8 | PubMed | ESearch | pubmed | Page load |
| 9 | PubMed | EFetch | pubmed | Page load |
| 10 | GEO | ESearch | gds | Page load |
| 11 | GEO | ESummary | gds | Page load |
| 12–14 | Sequence Foundation | ESearch + ESummary | nuccore | Page load |
| +1 | Transcript summary | EFetch (rettype=gb) | nuccore | First expand of a transcript row (lazy) |
| +1 | FASTA download | EFetch (rettype=fasta) | nuccore | "Download FASTA" click |
| +1 | CDS download | EFetch (rettype=fasta_cds_na) | nuccore | "Download CDS" click (NM_/XM_ only) |

**Totals:** ~13–14 calls on page load; ~14–15 with one expand; ~15–16 with
expand + one download. All calls are distinct and by design — no duplicates.
Every NCBI call is spaced by `GENE_RATE_DELAY_MS` (350ms), enforced both
client-side (download button queue) and server-side (route-level rate
limiter chains in `download/route.ts` and `summary/route.ts`).

Phase 5.4 accounting: adding a protein ELink/ESummary fallback path will add
~1–2 calls only for the (currently unobserved) case of a missing protein
line, bringing worst-case Scenario A to ~15–16 calls — still within budget.

---

## 5. TranscriptRecord Interface (final, as implemented)

```ts
interface TranscriptRecord {
  transcriptId: string;                    // unversioned, e.g. "NM_000546"
  accessionVersion: string;                 // versioned, e.g. "NM_000546.6"
  transcriptType: "mRNA" | "ncRNA" | "predicted_mRNA" | "predicted_ncRNA" | "other";
  accessionPrefix: "NM_" | "NR_" | "XM_" | "XR_" | "other";
  isProteinCoding: boolean;
  geneId: string;
  geneSymbol: string;
  organism: string;
  transcriptLength: number | null;          // nt, from gene_table
  exonCount: number | null;
  status: "Reviewed" | "Validated" | "Provisional" | "Predicted" | "Inferred" | "Model" | null;
  isCanonical: boolean | null;              // MANE Select; null for non-human (never false)
  maneSelectAccession: string | null;       // set on ALL records of a human gene
  manePlusClinical: boolean;
  proteinAccession: string | null;          // unversioned NP_/XP_; null for NR_/XR_
  proteinAccessionVersion: string | null;   // versioned
  sourceDatabase: "ncbi-refseq";
  ncbiTranscriptUrl: string;
}
```

Plus derivation helpers exported from the same file: `transcriptTypeFromAccession`,
`accessionPrefixFromAccession`, `isProteinCodingFromAccession`,
`refseqStatusFromAccession`, `sortTranscripts`.

---

## 6. GeneRecord.transcripts (final structure)

```ts
transcripts: {
  available: boolean;
  count: number | null;             // exact once fetched
  records: TranscriptRecord[] | null; // primary resolved gene only; null on failure
  maneSelectPresent: boolean | null; // null for non-human genes — never false
}
```

`GeneRecord.proteins` remains an availability-only stub reserved for Phase 5.4:

```ts
proteins: {
  available: boolean;        // heuristic: protein-coding gene (exonCount>0 + has summary)
  estimatedCount: number | null; // always null in current phases
}
```

The `ResourceBadge` UI component rendering `proteins` (in
`GeneExplorerSection.tsx`) takes no `onClick` prop today. Phase 5.4 can add
one without changing card layout.

---

## 7. Known Limitations (explicit)

- **BRCA1 transcript count (368)** is unusually high for a well-characterized
  gene; this value comes directly from the NCBI gene_table response as
  currently parsed and has not been independently cross-checked against
  another NCBI resource. Documented as observed behavior, not investigated
  further in this session (out of scope — no bug evidence, would require
  re-auditing an already-verified module).
- **Protein accession backfill (ELink) is unimplemented** — only the direct
  gene_table parse path exists. If a future gene's protein line is missing
  from gene_table, `proteinAccession` will be `null` and Phase 5.4 must
  implement the ELink fallback.
- **`geneType`, `hgncId`, `geneRifCount`** remain `null` for all genes —
  ESummary/ELink limitations documented in Phase 5.2, unchanged by 5.3.
- **RefSeq `status` granularity** — only "Reviewed"/"Predicted" are ever
  populated (deterministic from accession prefix); "Validated", "Provisional",
  "Inferred", "Model" are typed but never emitted, since nuccore ESummary's
  `status` field returned null in all tested cases.
- **Transcript pagination is 100% client-side** — all records for the primary
  gene are fetched once; "Load More Transcripts" only reveals more of the
  already-fetched array. This is intentional (avoids extra Entrez calls) but
  means very large transcript lists (e.g. BRCA1's 368) are all held in memory
  and sent over the wire in the initial `/api/analyze` response.

---

## 8. Phase 5.4 Entry Point

**Files to read first:**
1. `types/transcript-record.ts` — `proteinAccession` / `proteinAccessionVersion` fields (Section 5 above)
2. `lib/transcript/parser.ts` — where protein accessions are currently parsed (line ~116–132) and where the ELink TODO marker lives (line 131)
3. `types/gene-record.ts` — `GeneRecord.proteins` stub to expand
4. `app/api/analyze/route.ts` (lines ~362–392) — pattern for wiring a new module's result into `genes[0]`
5. `components/GeneExplorerSection.tsx` — `ResourceBadge` (Proteins) and `TranscriptRow` `DetailField` (Protein) as UI anchor points

**TranscriptRecord fields Phase 5.4 should consume directly (no new fetch needed):**
`proteinAccession`, `proteinAccessionVersion`, `accessionVersion`, `geneId`.

**NCBI API calls Phase 5.4 will likely need:**
- `esummary.fcgi?db=protein&id={NP_accession}` — protein metadata for accessions already known from `TranscriptRecord.proteinAccession`
- Fallback only: `elink.fcgi?dbfrom=gene&db=protein&id={geneId}` for the (currently unobserved) case where `proteinAccession` is null on a coding transcript

---

## 9. Architecture Summary

The chain flows **Query → Gene → Transcript → (Protein, Phase 5.4)**. A user
query is first resolved by the Biological Query Resolver (Phase 5.1.5) into a
canonical entity; when that entity is a gene, the Gene Explorer (Phase 5.2)
resolves it to an NCBI Gene ID and fetches core gene metadata via ESummary/ELink.
For the single primary resolved gene only, the Transcript Explorer (Phase 5.3)
is then invoked with that Gene ID — never with a raw query — and fetches the
gene_table (all organisms) plus MANE Select/Plus Clinical status (human only),
producing a sorted `TranscriptRecord[]` that is merged into
`GeneRecord.transcripts.records`. Protein accessions are already embedded in
each coding `TranscriptRecord` from the gene_table's protein isoform lines, so
Phase 5.4's Protein Explorer can attach directly to those accessions via a
lightweight ESummary call rather than re-deriving gene→protein linkage from
scratch — the `GeneRecord.proteins` stub and the `ResourceBadge` UI slot are
already reserved and require no layout changes to activate.

---

## Final Report Checklist

- [x] All Pre-5.4 readiness checklist items pass (see Section 2/6/7 above; only non-blocking limitation is the BRCA1 count anomaly, documented, not a defect in this module)
- [x] No new functionality was added in 5.3C — verification only, zero source files modified
- [x] Protein Explorer (Phase 5.4) can begin from this state
- [x] Remaining known limitations documented (Section 7)
- [x] TypeScript: 0 errors (`pnpm --filter @workspace/research-copilot exec tsc --noEmit`)
- [x] No Python files modified
- [x] No AI-generated sections modified

**STOP. Phase 5.4 (Protein Explorer) has not been implemented in this session, per instructions.**
