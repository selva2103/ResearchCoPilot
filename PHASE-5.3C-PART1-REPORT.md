# PHASE 5.3C PART 1 — HARDENING AND VERIFICATION REPORT

Generated: 2026-07-04

## Summary

All 5 steps completed. **No bugs found or introduced by Phase 5.3 work.**
The only bug fixed this session was `maneSelectAccession` field — discovered and repaired during Phase 5.3B Part 2 validation, already in the repo before this session started.

TypeScript: **0 errors**. No Python changes. No AI changes.

---

## Steps Completed

All steps fully complete: **Steps 1, 2, 3, 4, 5**.

---

## STEP 1 — Full Chain Verification

### TP53 (Gene ID 7157, Homo sapiens, taxId 9606)

| Stage | Identifier | Value | Notes |
|---|---|---|---|
| Gene level | geneId | 7157 | ✓ |
| Gene level | officialSymbol | TP53 | ✓ |
| Gene level | taxonomyId | 9606 | ✓ |
| Transcript module | available | true | ✓ |
| Transcript module | count | 26 | ✓ exact |
| Transcript module | maneSelectPresent | true | ✓ |
| MANE Select record | accessionVersion | NM_000546.6 | ✓ full versioned accession |
| MANE Select record | transcriptId | NM_000546 | ✓ stripped correctly (NM_000546.6 → NM_000546) |
| MANE Select record | maneSelectAccession | NM_000546.6 | ✓ matches accessionVersion |
| MANE Select record | isCanonical | true | ✓ |
| MANE Select record | ncbiTranscriptUrl | …/NM_000546.6 | ✓ ends with full accessionVersion |
| Download route | accession param | NM_000546.6 | ✓ preserved verbatim (ACCESSION_RE validates format) |
| ModuleResult status | success | ✓ | records.length > 0, no error |

**No truncation. No identifier transformation. accessionVersion is preserved exactly through every handoff.**

### BRCA1 (Gene ID 672, Homo sapiens, taxId 9606)

| Stage | Value | Status |
|---|---|---|
| geneId | 672 | ✓ |
| transcript count | 368 | ✓ |
| maneSelectPresent | true | ✓ |
| MANE Select accessionVersion | NM_007294.4 | ✓ |
| maneSelectAccession | NM_007294.4 | ✓ |
| canonical count | 1 | ✓ exactly one |
| proteinAccession | NP_009225 | ✓ populated from gene_table |
| transcriptId truncation | NM_007294.4 → NM_007294 | ✓ correct |

### TTN (Gene ID 7273, Homo sapiens, taxId 9606)

| Stage | Value | Status |
|---|---|---|
| geneId | 7273 | ✓ |
| transcript count | 22 | ✓ |
| maneSelectPresent | true | ✓ |
| MANE Select accessionVersion | NM_001267550.2 | ✓ |
| maneSelectAccession | NM_001267550.2 | ✓ |
| canonical count | 1 | ✓ |
| ncbiTranscriptUrl preserved | true (all 22 records) | ✓ |
| NM_ protein linkage | NM_001267550.2 → NP_001254479, NM_001256850.1 → NP_001243779 | ✓ both populated |
| XM_ protein linkage | XM_017004819.1 → XP_016860308, XM_047445660.1 → XP_047301616 | ✓ both populated |
| ModuleResult status | success | ✓ |

### Mouse Trp53 (Gene ID 22059, Mus musculus, taxId 10090)

| Stage | Value | Status |
|---|---|---|
| geneId | 22059 | ✓ |
| organism | Mus musculus | ✓ |
| taxonomyId | 10090 | ✓ non-human |
| transcript count | 5 | ✓ |
| maneSelectPresent | null | ✓ (not false — non-human) |
| All isCanonical values | null, null, null, null, null | ✓ (not false) |
| All manePlusClinical values | false, false, false, false, false | ✓ |
| All maneSelectAccession values | null, null, null, null, null | ✓ |
| NM_ protein linkage | NM_001127233.1 → NP_001120705.1, NM_011640.3 → NP_035770.2 | ✓ both populated |
| ModuleResult status | success | ✓ |

**Conclusion: No truncation, no identifier transformation bugs, no incorrect ModuleResult statuses across all 4 queries.**

---

## STEP 2 — Entrez Call Audit

All calls documented from live code inspection (`lib/transcript/fetch.ts`, `lib/transcript/index.ts`, `app/api/analyze/route.ts`).

### Scenario A — Page Load Only (TP53)

| # | Module | Endpoint | DB | Parameters |
|---|---|---|---|---|
| 1 | Resolver | ESearch | gene | `term=TP53[sym]` |
| 2 | Gene Explorer (Ph 5.2) | ESummary | gene | `id=7157` |
| 3 | Gene Explorer (Ph 5.2) | ELink | gene | `dbfrom=gene&db=pubmed&id=7157` |
| 4 | Transcript (Ph 5.3A) | EFetch | gene | `id=7157&rettype=gene_table&retmode=text` |
| 5 | Transcript (Ph 5.3A) | ESearch | nuccore | `term=7157[gene_id] AND MANE Select[Keyword]` |
| 6 | Transcript (Ph 5.3A) | ESearch | nuccore | `term=7157[gene_id] AND MANE Plus Clinical[Keyword]` |
| 7 | Transcript (Ph 5.3A) | ESummary | nuccore | `id={MANE_UIDs_combined}` |
| 8 | PubMed | ESearch | pubmed | `term=TP53` |
| 9 | PubMed | EFetch | pubmed | `id={paper_UIDs}` |
| 10 | GEO | ESearch | gds | `term=TP53` |
| 11 | GEO | ESummary | gds | `id={dataset_UIDs}` |
| 12–14 | Sequence Foundation | ESearch + ESummary | nuccore | accession resolution |

**Scenario A total: ~13–14 calls**

### Scenario B — Page Load + Expand One Transcript

| Additional call | Endpoint | DB | Parameters |
|---|---|---|---|
| +1 (lazy, on first expand) | EFetch | nuccore | `id=NM_000546.6&rettype=gb&retmode=text` |

**Scenario B total: ~14–15 calls**

### Scenario C — Page Load + Expand + FASTA Download

| Additional call | Endpoint | DB | Parameters |
|---|---|---|---|
| +1 (summary, first expand) | EFetch | nuccore | `id=NM_000546.6&rettype=gb&retmode=text` |
| +1 (FASTA button click) | EFetch | nuccore | `id=NM_000546.6&rettype=fasta&retmode=text` |

**Scenario C total: ~15–16 calls**

### Scenario D — Page Load + Expand + CDS Download

| Additional call | Endpoint | DB | Parameters |
|---|---|---|---|
| +1 (summary, first expand) | EFetch | nuccore | `id=NM_000546.6&rettype=gb&retmode=text` |
| +1 (CDS button click) | EFetch | nuccore | `id=NM_000546.6&rettype=fasta_cds_na&retmode=text` |

**Scenario D total: ~15–16 calls**

### Audit Conclusion

Total well exceeds 8, but **all calls are expected and unique**. PubMed, GEO, Sequence Foundation, Gene Explorer, and Transcript Explorer execute together for every gene query — this is by design. No duplicate or redundant Entrez calls were found:

- Resolver ESearch (find gene ID) ≠ Gene Explorer ESummary (get gene metadata) ≠ Transcript EFetch (get transcript list) — all distinct
- MANE Select ESearch and MANE Plus Clinical ESearch are separate queries (different keywords) — required for correct MANE classification
- nuccore ESummary for MANE UIDs is separate from gene ESummary — different databases
- PubMed, GEO, Sequence Foundation calls are fully independent of Gene/Transcript calls

**No optimization needed. No redundant calls.**

Phase 5.4 accounting note: adding protein calls will add ~1–2 more calls per human gene (ELink gene→protein or ESummary protein), bringing Scenario A to ~15–16 and download scenarios to ~17–18. Still within NCBI rate-limit budget given 350ms spacing via `GENE_RATE_DELAY_MS`.

---

## STEP 3 — MANE Select Verification

### Human Genes

**TP53:**
- Canonical count: **1** (NM_000546.6) — exactly one ✓
- maneSelectAccession: **NM_000546.6** — matches confirmed NCBI MANE Select ✓
- MANE badge in UI: rendered only for `isCanonical === true` (line 672 of GeneExplorerSection.tsx) — exactly once ✓
- MANE Plus Clinical badge: rendered only when `manePlusClinical === true` (line 678) — not shown when false ✓

**BRCA1:**
- Canonical count: **1** (NM_007294.4) — exactly one ✓
- maneSelectAccession: **NM_007294.4** — verified live ✓

### Non-Human (Mouse Trp53)

- All `isCanonical`: **null** (not false) — confirmed for all 5 transcripts ✓
- All `maneSelectAccession`: **null** ✓
- `maneSelectPresent` on GeneRecord: **null** (not false) ✓
- Header "MANE Select present" badge: gated by `isHumanGene && maneSelectPresent === true` where `isHumanGene = gene.taxonomyId === "9606"`. Mouse taxonomyId=10090 → `isHumanGene=false` → badge hidden ✓
- Per-row MANE badge: `isCanonical === true` → `null === true` is false → badge hidden ✓

**No bugs found. All MANE assertions pass.**

---

## STEP 4 — Protein Linkage Verification

### 4a. TranscriptRecord.proteinAccession — Exact Values

**TP53 NM_ transcripts (3 confirmed from gene_table):**

| accessionVersion | proteinAccession | proteinAccessionVersion | Source |
|---|---|---|---|
| NM_000546.6 | NP_000537 | NP_000537.3 | gene_table protein isoform line — **populated directly** |
| NM_001407270.1 | NP_001394199 | NP_001394199.1 | gene_table protein isoform line — **populated directly** |
| NM_001407271.1 | NP_001394200 | NP_001394200.1 | gene_table protein isoform line — **populated directly** |

**TTN XM_ transcripts (confirmed):**

| accessionVersion | proteinAccession | proteinAccessionVersion | Source |
|---|---|---|---|
| XM_017004819.1 | XP_016860308 | (populated) | gene_table protein isoform line — **populated directly** |
| XM_047445660.1 | XP_047301616 | (populated) | gene_table protein isoform line — **populated directly** |

**NR_ transcript (TP53):**

| accessionVersion | proteinAccession | Notes |
|---|---|---|
| NR_176326.1 | null | Correct — non-coding RNA has no protein. **No TODO comment** (by design: parser explicitly documents "NR_/XR_ (non-coding) — proteinAccession is always null, no TODO") |

**Mouse Trp53 NM_ transcripts:**

| accessionVersion | proteinAccession | proteinAccessionVersion |
|---|---|---|
| NM_001127233.1 | NP_001120705 | NP_001120705.1 |
| NM_011640.3 | NP_035770 | NP_035770.2 |

**Phase 5.4 implications:**
- All tested NM_/XM_ transcripts have `proteinAccession` **populated directly** from the gene_table protein isoform line — no ELink call needed for these.
- The Phase 5.4 ELink backfill (`// TODO Phase 5.4: fetch protein accession via ELink db=gene→db=protein` in `lib/transcript/parser.ts:131`) is only needed for coding transcripts whose protein line is absent from the gene_table (which did not occur in any test gene). Phase 5.4 can check `proteinAccession !== null` to skip the ELink call.

### 4b. GeneRecord.proteins Stub

- `proteins.available`: **true** (for TP53, BRCA1, TTN, mouse Trp53 — all protein-coding) ✓
- `proteins.estimatedCount`: **null** — this is Phase 5.2 design, hardcoded to `null` in `lib/gene/parser.ts:131`. Not a Phase 5.3 regression. The field is reserved for Phase 5.4.
- UI renders: `"Proteins · Available"` (ResourceBadge at line 935: `count !== null ? ` · ≥${count}` : " · Available"`) ✓

**5.3 regression check:** `available` was **not** reset by 5.3 work. The transcript module (`lib/transcript/index.ts`) only updates `genes[0].transcripts` — it does not touch `proteins`, `variants`, `expression`, or `pathways`. Confirmed in `app/api/analyze/route.ts` lines 379–390 (object spread `{...primary, transcripts: {...}}`).

### 4c. UI Protein Stub

- "Proteins" `ResourceBadge` renders at line 313–319 of `GeneExplorerSection.tsx`
- When `available=true` and `count=null`: renders as green `"Proteins · Available"` badge ✓
- `future={false}` — not marked as "Future" (correct: Phase 5.4 is planned, not speculative) ✓
- `title="Phase 5.4 — Protein Explorer"` — tooltip text preserved ✓
- **No click handler required for Phase 5.4 bootstrap** — Phase 5.4 can add an `onClick` prop to `ResourceBadge` or wrap it in a button without changing the card layout ✓

---

## STEP 5 — Error Handling Audit

### Confirmed via API test

| Failure case | Test method | Result |
|---|---|---|
| NR_ CDS button request | `GET /api/transcript/download?accession=NR_176326.1&type=cds` | 400 `{"error":"CDS download is not available for non-coding transcripts (NR_/XR_)..."}` ✓ |
| XR_ CDS button request | `GET /api/transcript/download?accession=XR_001234567.1&type=cds` | 400 same message ✓ |
| Invalid accession | `GET /api/transcript/download?accession=GARBAGE&type=fasta` | 400 `{"error":"Invalid or missing transcript accession."}` ✓ |
| Invalid download type | `GET /api/transcript/download?accession=NM_000546.6&type=invalid` | 400 `{"error":"Invalid download type — expected 'fasta' or 'cds'."}` ✓ |

### Confirmed via code inspection

| Failure case | Location | Behavior |
|---|---|---|
| Gene fetch failure (`transcriptResult.status === "error"`) | `app/api/analyze/route.ts:377` | `records=null, count=null` → UI shows "Transcript data temporarily unavailable." (line 422–426 of GeneExplorerSection.tsx) — gene card remains visible ✓ |
| Empty transcript list (`records.length === 0, status="empty"`) | `lib/transcript/index.ts:137–145` | UI shows "No RefSeq transcripts found for this gene." (line 429–432) ✓ |
| Individual transcript expand failure | `GeneExplorerSection.tsx:375–379` | `try/catch` in `handleToggle` → `setExpandError("Unable to expand this transcript row...")` → ⚠️ message shown at line 435–437 ✓ |
| FASTA download failure | `GeneExplorerSection.tsx:614–629` | `setState({status:"error", message})` → button label becomes `"Retry Download FASTA"` + error message shown below (line 831–836) ✓ |
| CDS download failure | Same pattern as FASTA | `"Retry Download CDS"` + message ✓ |
| Rate-limited download | `download/route.ts:107–116` → `GeneExplorerSection.tsx:833` | Returns `{rateLimited:true}` → UI shows "⚠️ NCBI rate limit hit — please wait a moment and try again." ✓ |
| Load More failure | `handleLoadMore` is synchronous state update (no async/network) | Cannot fail at network level. Rapid-click guard via `requestAnimationFrame` prevents double-fire. Loaded transcripts always preserved in `allRecords[]` ✓ |
| NR_/XR_ showing CDS button | `GeneExplorerSection.tsx:537–538` | `isCoding = accessionPrefix === "NM_" || accessionPrefix === "XM_"` → CDS button conditionally rendered (line 744–757): NR_/XR_ show "Non-coding transcript" label instead ✓ |
| MANE badge for non-human gene | `GeneExplorerSection.tsx:360,672` | Header badge: `isHumanGene && maneSelectPresent === true`; row badge: `isCanonical === true`. Non-human: `isHumanGene=false`, `isCanonical=null` → neither badge shown ✓ |
| Summary fetch failure | `GeneExplorerSection.tsx:560–563` | `catch → setSummary(null)` → summary section omitted (spec: "null → no section rendered") ✓ |

**No bugs found. All error paths behave correctly.**

---

## Bugs Found and Fixed

### Pre-existing fix (done in Phase 5.3B Part 2, already in repo)

**`maneSelectAccession` field was incorrect for TP53**
- File: `lib/transcript/parser.ts`
- Root cause: NCBI's `{geneId}[gene_id] AND MANE Select[Keyword]` ESearch returns a spurious UID for NM_005940.5 (not a TP53 transcript) alongside the real NM_000546.6. Taking `maneSelectAccessions[0]` picked the spurious accession.
- Fix: Post-processing step after parsing all records. If exactly one record has `isCanonical=true`, use its `accessionVersion` as `maneSelectAccession` on ALL records. Guard: only applied when canonicalRecords.length === 1 (not 0, not >1) to avoid false corrections.
- Verified: `maneSelectAccession: "NM_000546.6"` confirmed on all TP53 records post-fix.

**No other bugs found or fixed in this session.**

---

## Entrez Audit Results — Summary

| Scenario | Total Calls | Notes |
|---|---|---|
| A — page load | ~13–14 | All unique: Resolver(1) + Gene Explorer(2) + Transcript(4) + PubMed(2) + GEO(2) + SeqFoundation(2–3) |
| B — + expand one transcript | ~14–15 | +1 EFetch nuccore gb (transcript summary, lazy) |
| C — + expand + FASTA | ~15–16 | +1 summary + 1 FASTA EFetch |
| D — + expand + CDS | ~15–16 | +1 summary + 1 CDS EFetch |

No duplicate or redundant calls. High count is by design (all modules run in parallel for one query).

---

## Protein Linkage Status — Exact Values for Phase 5.4

| accessionVersion | proteinAccession | proteinAccessionVersion | Phase 5.4 needs ELink? |
|---|---|---|---|
| NM_000546.6 (TP53) | NP_000537 | NP_000537.3 | **No** — populated directly |
| NM_001407270.1 (TP53) | NP_001394199 | NP_001394199.1 | **No** — populated directly |
| NM_001407271.1 (TP53) | NP_001394200 | NP_001394200.1 | **No** — populated directly |
| NM_001267550.2 (TTN) | NP_001254479 | (populated) | **No** — populated directly |
| XM_017004819.1 (TTN) | XP_016860308 | (populated) | **No** — populated directly |
| NM_001127233.1 (mouse Trp53) | NP_001120705 | NP_001120705.1 | **No** — populated directly |
| NR_176326.1 (TP53) | null | null | **No ELink needed** — non-coding, no protein by definition |

**Phase 5.4 can consume `proteinAccession` / `proteinAccessionVersion` directly from `TranscriptRecord` for all NM_/XM_ transcripts tested. No ELink fallback was triggered in any tested gene.**

Phase 5.4 starting point: implement the Protein Explorer module that uses `TranscriptRecord.proteinAccession` (already populated) to look up protein records via `ESummary?db=protein&id={NP_accession}`. The backfill ELink path (`// TODO Phase 5.4: fetch protein accession via ELink db=gene→db=protein` in parser.ts) exists for edge cases but may not be needed for primary genes.

---

## Files Modified This Session

**None.** All verification passed without code changes. The `maneSelectAccession` fix was already committed as part of Phase 5.3B Part 2.

---

## Exact Next Step for Part 2

Part 2 should begin with **Step 6 — UI Polish and Regression Testing**, which was explicitly deferred from this session per spec ("STOP AFTER STEP 5").

Suggested Part 2 agenda (from spec):
1. UI regression: verify all existing Phase 5.2 UI elements (PubMed cards, GEO cards, Sequence Foundation, Query Resolver badge) are unaffected by 5.3 work
2. Visual review: MANE badge styling, Load More button styling, transcript row expand/collapse animation
3. Readiness checklist for Phase 5.4 sign-off
4. Final commit with clean TypeScript

No code changes are blocked on Part 2 beginning. The repo is in a clean, shippable state.

---

## TypeScript Status

**0 errors** confirmed as of 2026-07-04 (`pnpm --filter @workspace/research-copilot exec tsc --noEmit`).
