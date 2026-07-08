# PHASE 5.4A FINAL REPORT — Protein Explorer Foundation

Generated: 2026-07-07

This document is the entry point for Phase 5.4B. It assumes no prior conversation context.

---

## 1. Summary

Phase 5.4A implements the Protein Explorer Foundation as a self-contained, stable milestone. All coding transcripts in a gene now show a nested protein sub-panel when the transcript row is expanded. The panel displays accession (linked to NCBI), status badge (Reviewed/Predicted), length in aa, and a canonical badge for MANE Select proteins. Expanding the protein sub-panel fetches full GenPept detail (protein name, molecular weight) and reveals a Download FASTA button.

TypeScript: **0 errors**. No Python files modified. No AI-generated sections modified.

---

## 2. Files Created or Modified

All paths relative to `artifacts/research-copilot/`.

| File | Status | Purpose |
|---|---|---|
| `types/protein-record.ts` | **Created** | `ProteinRecord` interface + `proteinStatusFromAccession` helper |
| `lib/protein/fetch.ts` | **Created** | `fetchProteinSummaries`, `fetchProteinDetail`, `fetchProteinFasta` |
| `lib/protein/parser.ts` | **Created** | `parseProteinSummary`, `enrichWithDetail` |
| `lib/protein/index.ts` | **Created** | `getProteinsForTranscripts`, `getProteinDetail` |
| `app/api/protein/summaries/route.ts` | **Created** | POST — batched protein summary for a gene's transcripts |
| `app/api/protein/detail/route.ts` | **Created** | POST — on-demand GenPept detail for one protein |
| `app/api/protein/download/route.ts` | **Created** | GET — protein FASTA download proxy |
| `components/GeneExplorerSection.tsx` | **Modified** | `ProteinPanel` component nested in `TranscriptRow`; protein summary state in `TranscriptExplorer` |

No existing files were removed. No Python files were touched. No AI-generated sections were modified.

---

## 3. ProteinRecord Interface (final, as implemented)

```ts
interface ProteinRecord {
  // Core identity
  proteinAccession: string;              // e.g. "NP_000537"
  proteinAccessionVersion: string;       // e.g. "NP_000537.3"
  proteinAccessionVersionSource: "transcript"; // always — never independently resolved
  sourceDatabase: "ncbi-refseq";
  status: "Reviewed" | "Predicted" | "Other"; // NP_→Reviewed, XP_→Predicted
  isCanonical: boolean | null;           // direct inheritance from TranscriptRecord.isCanonical
  ncbiProteinUrl: string;                // https://www.ncbi.nlm.nih.gov/protein/{accVer}

  // Traceability (from parent TranscriptRecord — no new fetch)
  transcriptId: string;
  geneId: string;
  geneSymbol: string;
  organism: string;

  // Summary metadata (from ESummary)
  length: number | null;                 // aa; from ESummary `slen`
  sequenceAvailable: boolean;            // false if slen=0 or absent

  // Detail metadata (from GenPept EFetch — on-demand)
  proteinName?: string | null;           // /product= qualifier in Protein feature
  molecularWeight?: number | null;       // /calculated_mol_wt= qualifier — optional
}
```

`proteinStatusFromAccession` derivation helper exported from the same file.

---

## 4. NCBI Protein API Response Structure (observed)

### ESummary (db=protein) — confirmed for NP_000537.3

```
GET esummary.fcgi?db=protein&id=NP_000537.3,NP_001394199.1,...&retmode=json

result.uids: ["120407068", "2246031087", ...]
result["120407068"]:
  uid: "120407068"
  caption: "NP_000537"            ← unversioned accession
  title: "cellular tumor antigen p53 isoform a [Homo sapiens]"
  slen: 393                       ← length in aa
  accessionversion: "NP_000537.3" ← versioned accession
  sourcedb: "refseq"
```

**Key finding:** ESummary accepts `accession.version` strings directly as the `id` parameter for `db=protein`. No prior ESearch or ELink UID-resolution step is needed. A single batched call covers all proteins in a gene.

### GenPept EFetch (db=protein rettype=gp) — confirmed for NP_000537.3

```
LOCUS       NP_000537   393 aa   linear   PRI 21-NOV-2025
DEFINITION  cellular tumor antigen p53 isoform a [Homo sapiens].
FEATURES             Location/Qualifiers
     Protein         1..393
                     /product="cellular tumor antigen p53 isoform a"
                     /calculated_mol_wt=43522
```

- **proteinName**: `/product=` qualifier in the `Protein` feature (single or multi-line)
- **molecularWeight**: `/calculated_mol_wt=` qualifier — integer, Daltons (optional, not on all records)
- **length**: LOCUS line, second numeric token before ` aa`

---

## 5. Entrez Call Map (full TP53 session with Protein Explorer)

| # | Module | Endpoint | DB | Trigger |
|---|---|---|---|---|
| 1–14 | Pre-5.4A modules | (unchanged) | various | Page load |
| +1 | Protein Explorer | ESummary (batch) | protein | First coding transcript expand in a gene |
| +1 | Protein Explorer | EFetch (rettype=gp) | protein | User expands a specific protein sub-panel |
| +1 | Protein Explorer | EFetch (rettype=fasta) | protein | "Download FASTA" click |

**Call counts for a full TP53 session (expand list + one protein detail + one download):**
- Page load: ~13–14 calls (unchanged from Phase 5.3C)
- First coding transcript expand: +1 (batched ESummary for all ~20 TP53 proteins in one call)
- One protein sub-panel expand: +1
- One FASTA download: +1
- **Total: ~16–17 calls** — within budget

**Non-coding transcript expand (NR_/XR_):** triggers zero protein NCBI calls. The batch fetch is gated on `hasCodingProtein` (i.e. `proteinAccessionVersion !== null`) in `handleToggle`.

---

## 6. Caching Strategy

Redis caching is **not yet wired** to these TypeScript modules (same TODO as transcript modules). Cache keys are documented for Phase 5.4B activation:

```
protein:summary:{proteinAccessionVersion}   # ESummary entry per protein
protein:detail:{proteinAccessionVersion}    # GenPept flat-file per protein
protein:fasta:{proteinAccessionVersion}     # FASTA sequence per protein
```

Recommended TTL: ≥ 86,400 seconds (24h). Protein records are immutable once versioned — aggressive caching is safe.

---

## 7. Canonical Protein Inheritance

`isCanonical` in ProteinRecord is set by a single line in `parseProteinSummary`:

```ts
isCanonical: transcript.isCanonical,
```

This is direct inheritance from the parent `TranscriptRecord` with no independent protein-side logic. Semantics match exactly:

| Scenario | TranscriptRecord.isCanonical | ProteinRecord.isCanonical |
|---|---|---|
| Human, MANE Select | `true` | `true` |
| Human, non-MANE | `false` | `false` |
| Non-human | `null` | `null` |

The canonical badge in the UI is gated on `isCanonical === true` (strict equality) — never shown when `null` or `false`.

---

## 8. Known Limitations

- **Redis caching not wired**: `cached: false` on all ProteinRecord responses (same as transcript modules). Phase 5.4B should activate the documented keys.
- **ELink protein backfill not implemented**: If a future gene's `proteinAccessionVersion` is `null` on a coding transcript (edge case, not observed in tested genes), that protein is silently omitted from the batch. The Phase 5.3C TODO marker in `lib/transcript/parser.ts` line 131 still applies; Phase 5.4B can implement ELink fallback for these cases.
- **proteinName populated from GenPept only**: At summary time, `proteinName` is `null`. It is populated only when the user expands the protein sub-panel (on-demand GenPept fetch). The ESummary `title` field contains the name but with an organism suffix (e.g. " [Homo sapiens]"), which would require trimming — deferred to Phase 5.4B to keep this phase minimal.
- **molecularWeight absent on some records**: Observed as expected. The field is typed `number | null` and rendered only when non-null.
- **sequenceAvailable heuristic**: Set to `false` only when `slen === 0` or absent in ESummary. A retired accession that still returns `slen > 0` in ESummary would have `sequenceAvailable: true`, then fail on download. The retry button handles this gracefully.

---

## 9. Phase 5.4B Entry Point

**Files to read first:**
1. `types/protein-record.ts` — full interface (Section 3 above)
2. `lib/protein/fetch.ts` — fetchProteinSummaries, fetchProteinDetail, fetchProteinFasta
3. `lib/protein/parser.ts` — parseProteinSummary, enrichWithDetail
4. `lib/protein/index.ts` — getProteinsForTranscripts, getProteinDetail
5. `components/GeneExplorerSection.tsx` — ProteinPanel component (~line 800+), TranscriptExplorer protein state (~line 373+)

**Fields still needing Phase 5.4B work:**
- `proteinName`: could be pre-populated at summary time from ESummary `title` (strip organism suffix) — Phase 5.4B decision
- `molecularWeight`: parse validation and unit display (already renders "Da" when present)
- Redis activation: wire `protein:summary:*`, `protein:detail:*`, `protein:fasta:*` keys using existing Redis client

**Error states for 5.4B hardening:**
- Detail fetch failure shows an error message but no retry button — add retry
- `sequenceAvailable: false` disables download button (currently, the button is always shown once detail loads — 5.4B should check this flag)
- Partial status (some proteins missing from ESummary) shows a user-visible warning — verify UX

**Phase 5.4B scope (do NOT implement in 5.4A):**
- Protein function/keywords/region summary text
- Full validation/regression suite
- Error/validation hardening beyond current basic states

---

## Final Report Checklist

- [x] No regressions to Transcript Explorer (accordion, FASTA/CDS downloads, pagination unchanged)
- [x] No regressions to Gene Explorer (Gene ID, chromosome unchanged)
- [x] TypeScript: 0 errors (`pnpm --filter @workspace/research-copilot exec tsc --noEmit`)
- [x] No Python files modified
- [x] No AI-generated sections modified
- [x] No standalone protein search added
- [x] No new rate limiter, cache layer, or retry system introduced (reused existing patterns)
- [x] No Phase 5.4B/5.4C scope implemented
- [x] App stable and runnable at end of phase

**STOP. Phase 5.4B (protein summary text, error hardening, full regression) has not been implemented.**
