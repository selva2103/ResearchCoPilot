# Phase 5.3B Part 1 — Transcript Explorer Interactivity Final Report
**Date:** 2026-07-03
**Component:** Transcript Explorer (interactive layer — accordion + FASTA/CDS downloads)
**Status:** ✅ COMPLETE — validated end-to-end against live NCBI EFetch data

---

## 1. What was built

- `components/GeneExplorerSection.tsx`
  - `TranscriptExplorer` now owns accordion state: `expandedAccession` (a single
    `string | null`, never an array/set) so at most one `TranscriptRow` is
    expanded at a time across the whole gene card. Starts `null` — nothing is
    auto-expanded on load, matching the spec.
  - `handleToggle` is wrapped in try/catch; on any thrown error it sets an
    `expandError` message and renders it inline (`⚠️ …`) without unmounting or
    crashing the rest of the gene card.
  - `TranscriptRow` header (accession badge, type, length, exon count, status,
    MANE badges) is now a clickable `<button>` that toggles expand/collapse for
    that row only, with a `▼ Show details` / `▲ Hide details` affordance and
    `aria-expanded`.
  - Expanded panel shows transcript ID, protein accession (linked to NCBI
    Protein when present, "N/A — non-coding" for NR_/XR_, "Not available" for
    unresolved NM_/XM_ per the Phase 5.4 TODO already in the parser), a link to
    NCBI Nucleotide, and the download controls.
  - "Download FASTA" is now a real, functional button for every transcript
    (previously a disabled placeholder).
  - "Download CDS" is functional and shown **only** for `NM_`/`XM_` (coding)
    transcripts. For `NR_`/`XR_` (non-coding) transcripts, a
    "Non-coding transcript" label renders in its place — no button, no dead
    click target.
  - Each download button tracks its own `idle | loading | error` state; on
    failure the button becomes "Retry {label}" and shows an inline message
    (rate-limit-specific copy when the failure was a 429).
  - A module-level `enqueueDownload()` promise chain serializes every download
    click across the whole page client-side, so rapid double-clicks (or clicks
    across different transcript rows/genes) never fire concurrent requests.

- `lib/transcript/fetch.ts`
  - Added `fetchTranscriptSequence(accessionVersion, rettype)` — a thin,
    pattern-consistent wrapper around the same `ncbiFetch` helper already used
    by `fetchGeneTable`/`fetchManeInfo`, hitting
    `efetch.fcgi?db=nuccore&id={accession}&rettype=fasta|fasta_cds_na&retmode=text`.
    No other function in this file was modified.

- `app/api/transcript/download/route.ts` (new)
  - `GET /api/transcript/download?accession=...&type=fasta|cds`.
  - Validates the accession against `^(NM_|NR_|XM_|XR_)\d+\.\d+$` — rejects
    anything else with 400 before making any NCBI call.
  - Rejects `type=cds` for `NR_`/`XR_` accessions with a 400 and an explicit
    "not an error — non-coding RNAs have no coding sequence" message (this is
    also enforced client-side by simply not rendering the CDS button, so this
    server check is defense-in-depth, not something a normal user can trigger).
  - Serializes all outgoing NCBI calls through a module-scoped promise chain
    + `lastCallAt` timestamp, reusing the exact same `GENE_RATE_DELAY_MS`
    (350 ms) constant and `sleep()` helper imported from
    `lib/gene/search.ts` — the same rate-limit primitive every other module in
    this codebase uses. This guarantees sequential, non-concurrent NCBI calls
    even if multiple browser tabs or rapid clicks hit the route at once.
  - On success, returns the raw FASTA text with
    `Content-Disposition: attachment; filename="{accession}[_cds].fasta"` so
    the browser download is a real file, not inline text.
  - On failure, returns a JSON `{ error, rateLimited? }` body with 429 for
    rate-limit errors (passed through from NCBI) and 502 for other upstream
    failures, which the client renders as a specific message.

## 2. Live validation results

All checks were run against the live dev server (`POST /api/analyze` and
direct `GET /api/transcript/download` calls) using TP53 (gene ID 7157,
26 transcripts, confirmed unchanged from Phase 5.3A).

| Scenario | Request | Result |
|---|---|---|
| FASTA download, coding transcript | `GET .../download?accession=NM_000546.6&type=fasta` | 200, real mRNA FASTA, `Content-Disposition: attachment; filename="NM_000546.6.fasta"` |
| CDS download, coding transcript | `GET .../download?accession=NM_000546.6&type=cds` | 200, `fasta_cds_na` body starting `>lcl|NM_000546.6_cds_NP_000537.3_1 …`, filename `NM_000546.6_cds.fasta` |
| FASTA download, non-coding transcript | `GET .../download?accession=NR_176326.1&type=fasta` | 200, full ncRNA FASTA — non-coding transcripts still get a full-sequence FASTA, just no CDS |
| CDS download, non-coding transcript | `GET .../download?accession=NR_176326.1&type=cds` | 400, `"CDS download is not available for non-coding transcripts (NR_/XR_)…"` |
| Invalid accession | `GET .../download?accession=garbage&type=fasta` | 400, `"Invalid or missing transcript accession."` |
| Missing `type` param | `GET .../download?accession=NM_000546.6` | 200, defaults to `fasta` |
| Concurrency/rate-limit | 3 simultaneous `curl` requests for 3 different TP53 transcripts | Completed sequentially at ~0.58s / ~1.09s / ~1.57s — confirms the server-side queue is spacing calls by ~`GENE_RATE_DELAY_MS`, not firing them in parallel |
| `pnpm exec tsc --noEmit` | full project | Clean, no errors |
| `/api/analyze` for TP53 | full pipeline | `genes.length === 1`, `transcripts.count === 26`, records unchanged from 5.3A (accession/prefix/protein data intact) — confirms no regression to the read path |

## 3. Error handling coverage (Step 4 of the spec)

- **Expand failure:** `handleToggle` is try/catch-wrapped; any thrown error
  sets a visible `expandError` banner in the Transcript Explorer section
  without unmounting the gene card or any sibling section (PubMed/GEO/
  Sequence/other genes untouched).
- **Download failure:** each button independently tracks `error` state and
  flips to a "Retry {label}" affordance; clicking retry re-enqueues the same
  download through the same rate-limited queue. A network-level exception
  (e.g. fetch throws) is also caught and surfaces a generic message instead of
  an unhandled rejection.
- **Rate-limit messaging:** both the client (checks `res.status === 429` /
  `body.rateLimited`) and the server (detects `"429"`/`"rate limit"` in the
  thrown error message, same convention as `lib/transcript/index.ts`) produce
  the specific copy "NCBI rate limit hit — please wait a moment and try
  again." instead of a generic failure message.
- **Non-coding transcripts:** never shown a CDS button at all (not a disabled
  button, not an error state) — the "Non-coding transcript" label makes this
  a designed absence, not a failure.

## 4. Regression checks

- `pnpm exec tsc --noEmit -p artifacts/research-copilot` — clean.
- `git diff --stat` (excluding `.next/` build cache) shows only:
  - `artifacts/research-copilot/components/GeneExplorerSection.tsx` (modified)
  - `artifacts/research-copilot/lib/transcript/fetch.ts` (modified — additive only)
  - `artifacts/research-copilot/app/api/transcript/download/route.ts` (new)
- No changes to `lib/transcript/parser.ts`, `lib/transcript/index.ts`,
  `types/transcript-record.ts`, `types/gene-record.ts`, `app/api/analyze/route.ts`,
  or any Python/Redis/PubMed/GEO/Sequence Foundation/Resolver/AI code.
- `/api/analyze` TP53 response verified byte-for-byte compatible in shape with
  Phase 5.3A's `transcripts.records` (same 26 accessions, same `accessionPrefix`/
  `isProteinCoding` values spot-checked above) — the read path that Part 1
  builds on is unmodified.

## 5. Explicitly out of scope for Part 1 (deferred to Part 2)

- Transcript summaries/descriptions beyond what `TranscriptRecord` already carries.
- Pagination or lazy loading of the transcript list itself (all transcripts
  for the primary gene are still rendered as a flat, collapsible list, exactly
  as in 5.3A — only expand/collapse and download behavior changed).
- The full validation suite across multiple organisms (TP53/BRCA1/mouse/
  non-gene) that Phase 5.3A already ran for the underlying data — Part 1 only
  needed to confirm the interactive layer works correctly, which it does
  against the same TP53 dataset validated in 5.3A.

## 6. Files changed

```
artifacts/research-copilot/components/GeneExplorerSection.tsx   (modified)
artifacts/research-copilot/lib/transcript/fetch.ts               (modified, additive only)
artifacts/research-copilot/app/api/transcript/download/route.ts  (new)
```

## 7. Conclusion

Phase 5.3B Part 1 is functionally complete: transcript rows expand/collapse
accordion-style (one at a time, never auto-expanded), FASTA downloads work for
every transcript, CDS downloads work for coding transcripts only and are
replaced by a "Non-coding transcript" label for NR_/XR_, all NCBI calls for
downloads are serialized through the same `GENE_RATE_DELAY_MS`/`sleep`
convention used elsewhere in the codebase (verified empirically to space
concurrent requests rather than firing them in parallel), and every failure
mode (expand, download, rate-limit) is caught and surfaced without crashing
the gene card. No Part 2 scope (summaries, pagination, lazy loading, full
multi-organism validation suite) was implemented, per the task boundary.
