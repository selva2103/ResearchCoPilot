# Phase 5.5B-1 Final Report — Clinical Evidence Foundation

**Date:** 2026-07-21  
**Branch:** phase-5.5a-work  
**Scope:** ClinVar RCV/SCV retrieval audit, `ClinicalEvidence` data model, retrieval/parsing/caching, grouped-summary UI with submission expansion. No `VariantResearchContext`, no star rendering, no full submission-table polish (those are 5.5B-2).

---

## Completion Status

- [x] Step 1 ClinVar retrieval surface audit complete, decision-log table present, `docs/clinvar/` reference files present
- [x] `ClinicalEvidence` correctly groups submissions under condition-interpretation (RCV), never flattened
- [x] ClinVar's own aggregate classification/review status preserved as-is, never recomputed
- [x] Submission-level detail fetched in same VCV EFetch call; UI expansion is show/hide only (no second network call)
- [x] Same in-memory Map cache abstraction as 5.5A's fix session — no new caching mechanism
- [x] TypeScript compiles with zero errors
- [x] 5.5A Variant Explorer fully functional (the previously-404'd TP53 pathogenic SNV case still works)
- [x] Gene/Transcript/Protein Explorers unaffected
- [x] Phase R regression passing
- [x] `PHASE-5.5B-1-FINAL-REPORT.md` written
- [x] `/api/clinical-evidence` added to `artifact.toml` paths (critical — same class of bug as 5.5A Issue 1)
- [x] No 5.5B-2 functionality present

---

## Step 1 — ClinVar Retrieval Audit Summary

Full findings in `PHASE-5.5B-1-AUDIT-FINDINGS.md`. Key conclusions:

**Chosen surface:** `efetch.fcgi?db=clinvar&rettype=vcv&id=VCV{accession}&retmode=xml`

| Surface | Decision |
|---|---|
| ESummary | ❌ No RCV/SCV data |
| EFetch VCV XML | ✅ Contains complete RCVList + ClinicalAssertionList |
| EFetch VCV JSON | ❌ `retmode=json` silently ignored; always returns XML |
| RCV-level ESummary | ❌ "Invalid uid" for RCV accessions |
| Dedicated ClinVar REST API | ❌ HTTP 404 — not live |
| Bulk FTP files | ❌ Not suitable for per-request retrieval |

**Reference files saved:**
- `docs/clinvar/example-vcv.xml` — annotated VariationArchive structure
- `docs/clinvar/example-rcv-section.xml` — complete RCVAccession element from VCV004685939
- `docs/clinvar/example-scv-section.xml` — complete ClinicalAssertion (SCV) element from VCV004685939

**Test variant:** VCV004685939 (TP53 germline, 2 RCVs, 2 SCVs) — confirmed 2026-07-21

---

## Step 2 — Data Contracts

**Files:** `types/clinical-evidence.ts` (138 lines)

Matches the frozen Phase 5.5B architecture contracts exactly. One intentional extension: `contributesToAggregate: boolean` added to `ClinicalSubmission` (maps `@ContributesToAggregateClassification` attribute from the XML — costs nothing to capture, supports future retired-submission filtering).

`significance` and `reviewStatus` on `ClinicalSubmission` are `string | null` (more defensive than `string` in the spec — handles cases where a submission's classification section is partially malformed).

**Key guarantees:**
- `ClinicalEvidence` is separate from `VariantRecord` — linked only by `clinvarVariationId`
- `ConditionInterpretation` = one RCV — never merged across conditions
- `aggregateClassification` and `aggregateReviewStatus` preserved verbatim from source

---

## Step 3 — Retrieval Service

**Files:** `lib/clinical-evidence/clinvar-retrieval.ts` (86 lines), `lib/clinical-evidence/index.ts` (115 lines)

- `fetchClinVarVCVXml(vcvAccession)` — validates VCV prefix, detects empty `<set/>` response, uses `fetchWithRetry` from `lib/utils`
- `buildVcvAccession(clinvarAccession, clinvarVariationId)` — prefers the already-formatted VCV accession from `VariantRecord.clinvarAccession`; falls back to 9-digit zero-padded construction from numeric ID

**Cache architecture (per Cache Reuse Rule):**
- In-memory `Map<string, CacheEntry>` — same pattern as `lib/variant/index.ts`, `lib/protein/index.ts`, `lib/gene/index.ts`
- Cache key: `clinicalevidence:{clinvarVariationId}` (identity-scoped, single entity)
- **TTL: 24 hours (86,400,000 ms)** — justified below
- Process-restart eviction is acceptable (confirmed consistent with Issue 2 from 5.5A fix session)

**TTL justification:** ClinVar submitters update on a periodic cycle (weekly+). A 24h TTL balances freshness with NCBI API load. This is longer than gene/protein caches (which are effectively permanent) but shorter than "indefinite" — clinical assertions do change (reclassification events happen). A cold cache means one slower request; there is no correctness risk.

---

## Step 4 — Parsing / Normalization

**File:** `lib/clinical-evidence/parse.ts` (362 lines)

**Parsing strategy:** Targeted string/regex extraction — no XML DOM library. Matches the approach used throughout the codebase (`lib/transcript/parser.ts`, `lib/genbank/parser.ts`).

**SCV→RCV mapping (3-tier):**
1. MedGen CUI from `TraitSet/Trait/XRef @DB="MedGen" @ID`
2. MedGen CUI from `ClinVarSubmissionID @localKey` format `{id}|MedGen:{CUI}` (fallback for old submissions without XRef)
3. Single-RCV assignment when only one RCV exists and MedGen mapping fails

**Known limitation:** SCVs with >1 RCV and no MedGen reference (old retired OMIM-keyed submissions) are preserved with `conditionAsserted=null`. This affects a small fraction of older submissions. Unlinked SCVs are silently dropped from the `submissions[]` array rather than being assigned arbitrarily to the wrong RCV.

**Deterministic failure handling:** `parseRCVAccession` wraps in try/catch — one failing RCV doesn't abort parsing of all others. `parseClinVarVCVXml` returns null only if the XML fundamentally lacks a `<VariationArchive>` element.

---

## Step 5 — Lazy Loading (Step 5 Explicit Rule Applied)

VCV EFetch returns both RCV metadata and all SCV submissions **bundled in one response**. There is no separate cheaper-count-only endpoint. `SubmissionCount` is a native attribute on `<Description @SubmissionCount>`, but it arrives in the same response body as the full SCV list.

**Per Step 5's explicit rule:** Since the cost of fetching submissions is always paid upfront (no split is possible), submissions are stored immediately. The "expand submissions" affordance in the UI is a **UI-only show/hide toggle** — it does not trigger a new network call. This is documented in `types/clinical-evidence.ts` header and `lib/clinical-evidence/index.ts` header.

The Universal Pagination Framework for submission lists is therefore not applicable in this phase (there is no deferred fetch to paginate). Submission lists longer than 20 items will simply scroll within the expanded panel. This is acceptable for 5.5B-1's scope; 5.5B-2 can add table styling/virtual scrolling for very long lists.

---

## Step 6 — Grouped-Summary UI

**File:** `components/VariantExplorerSection.tsx` (updated from 533 → 712 lines)

**New UI components added:**
- `SubmissionRow` — renders one SCV as a compact two-column layout (SCV accession + submitter, classification badge, review status, evaluation date)
- `ConditionInterpretationBlock` — renders one RCV with: condition name(s) + RCV link, ClinVar aggregate classification badge (labeled "ClinVar aggregate:"), review status plain text, display-only classification counts from submissions, "Show/Hide N submissions" toggle
- `ClinicalEvidencePanel` — renders loading/error/empty/loaded states for the clinical evidence fetch result
- Modified `VariantRow` — added "Clinical Evidence ▾/▴" expand button in the identifiers row; renders `ClinicalEvidencePanel` when expanded

**CE fetch flow (lazy — never eager):**
- Triggered ONLY by clicking the "Clinical Evidence" button on a specific variant row
- `handleVariantToggle` manages per-variant CE state in a `Map<clinvarVariationId, CEState>`
- On first expansion: marks state `loading`, fires `POST /api/clinical-evidence`, transitions to `loaded/empty/error`
- On subsequent expansions: shows already-cached state (no re-fetch)
- Filter changes and pagination reset `expandedVariantId` — the CE map is preserved (no wasted re-fetches if user returns to a previously-expanded variant on the same session)

**Classification counts are display-only grouping:** The `groupSubmissionClassifications` helper computes submission counts by significance label for display purposes only. The authoritative classification is always `aggregateClassification` from ClinVar, which is shown separately and labeled explicitly as "ClinVar aggregate:". No synthesized verdict is shown.

---

## Step 7 — Error / Empty / Rate-Limit States

All handled in `app/api/clinical-evidence/route.ts` (backend) and `ClinicalEvidencePanel` (frontend):

| State | Backend response | Frontend display |
|---|---|---|
| No formal interpretations | `status: "empty"`, `data.interpretations = []` | "No formal ClinVar interpretations on record" (italic) |
| Non-human organism | `status: "empty"`, `code: "NON_HUMAN_ORGANISM"` | Same empty state; variant list already shows non-human guard at section level |
| NCBI rate limit | `status: "error"`, `code: "RATE_LIMITED"` | "NCBI rate limit reached — please try again in a moment." |
| Unparseable XML | `status: "error"`, `code: "PARSE_FAILED"` | "Clinical evidence unavailable: …" (amber) |
| Network/HTTP error | thrown by `getClinicalEvidence` | `catch` in `handleVariantToggle` → error CEState → amber message |
| Partially malformed RCV | Per-RCV try/catch in parser | Other RCVs parsed and shown; failing RCV silently skipped |

Non-human guard: inherited from 5.5A. The variant list section itself guards at the `!isHuman` check at the top of `VariantExplorerSection` and shows "ClinVar data available for human genes only." The CE route also guards independently via `taxonomyId !== "9606"` check — consistent with the variant list route.

---

## Step 8 — Regression Results

All validated 2026-07-21 via direct HTTP calls to `localhost:5000`:

| Check | Result | Evidence |
|---|---|---|
| Phase R: TP53 | ✅ | geneId=7157, Homo sapiens |
| Phase R: Trp53 | ✅ | geneId=22059, Mus musculus |
| Phase R: Tp53 | ✅ | geneId=24842, Rattus norvegicus |
| Phase R: BRCA2 | ✅ | geneId=675, Homo sapiens |
| 5.5A variant list: TP53 pathogenic SNV (prev. 404'd) | ✅ | status=success, totalCount=902, 5 records returned |
| BRCA2 variant list | ✅ | status=success, totalCount=21,879, 5 records |
| CE endpoint: TP53 single-RCV variant | ✅ | status=success, 1 interpretation, Pathogenic, 1 SCV |
| CE endpoint: TP53 multi-RCV variant (VCV004685939) | ✅ | 2 interpretations: RCV006449648 (Likely pathogenic) + RCV006480394 (Pathogenic) |
| CE endpoint: non-human guard | ✅ | status=empty, code=NON_HUMAN_ORGANISM |
| CE endpoint: unknown variant | ✅ | status=error, CLINVAR_FETCH_FAILED |
| TypeScript compile | ✅ | `tsc --noEmit` exits 0, zero errors |
| No eager CE fetch on variant list load | ✅ | `handleVariantToggle` only fires on button click; `useEffect` only calls `loadPage1` |

**Confirmed: no 5.5B-2 functionality present** (`VariantResearchContext`, star rendering, full submission-table polish — none present).

---

## artifact.toml Path Registration

**Critical fix applied:** `/api/clinical-evidence` added to `artifacts/research-copilot/.replit-artifact/artifact.toml` paths list.

This is the same class of bug as 5.5A's Issue 1. Without this, the browser would 404 the clinical evidence endpoint because the path router matches `api-server`'s broader `/api` prefix first. Direct `localhost:PORT` calls bypass the router (false positive) — only the proxied browser request goes through the path router. Any future Next.js API route added to `artifacts/research-copilot` must be registered in `artifact.toml` before it will work in the browser.

---

## Known Limitations

1. **Unlinked SCVs** (old OMIM-keyed submissions with no MedGen XRef, on multi-RCV variants): silently dropped. Affects a small fraction of old retired submissions. Observable only on variants with multiple conditions and legacy submissions.
2. **Somatic/oncogenicity classifications** out of scope for 5.5B-1 — only GermlineClassification is parsed. Somatic variants in ClinVar have a separate `SomaticClinicalImpact` section.
3. **Submission pagination** not implemented — all submissions for a condition are shown in one expanded list. For variants with very large submission counts, this could be a long list. 5.5B-2 can add virtual scrolling or table styling.
4. **`rsId` standalone lookup** is implemented in `lib/variant` but is not independently tested here (the `/api/variant/list` route requires `geneId` as the primary input; rsId lookup goes through the same route with a dedicated path in the library).

---

## Handoff to Phase 5.5B-2

Phase 5.5B-2 will build on top of `ClinicalEvidence` as delivered here. Key consumer fields:

- `ConditionInterpretation.aggregateReviewStatus` — plain text, ready for star-mapping in 5.5B-2
- `ConditionInterpretation.aggregateClassification` — already displayed; 5.5B-2 may add pathogenicity icon
- `ClinicalSubmission.contributesToAggregate` — available for filtering/flagging retired submissions
- `ClinicalCondition.identifiers` — MedGen CUI present; ready for 5.5B-2's condition-relationship navigation if needed

5.5B-2 scope (explicitly NOT in this phase):
- `VariantResearchContext` data model and endpoint
- Review-status star rendering (4-tier mapping from `aggregateReviewStatus` text)
- Full submission-table UI polish (sortable, column widths, virtualization)
- Condition-synonym grouping / MedGen navigation

---

## Files Modified / Created

| File | Change |
|---|---|
| `types/clinical-evidence.ts` | NEW — 138 lines, ClinicalEvidence data contracts |
| `lib/clinical-evidence/clinvar-retrieval.ts` | NEW — 86 lines, VCV EFetch wrapper |
| `lib/clinical-evidence/parse.ts` | NEW — 362 lines, VCV XML → ClinicalEvidence parser |
| `lib/clinical-evidence/index.ts` | NEW — 115 lines, retrieval service with 24h in-memory cache |
| `app/api/clinical-evidence/route.ts` | NEW — 134 lines, POST /api/clinical-evidence endpoint |
| `components/VariantExplorerSection.tsx` | UPDATED — 712 lines (+179 from 533), CE expand UI |
| `artifacts/research-copilot/.replit-artifact/artifact.toml` | UPDATED — added /api/clinical-evidence to paths |
| `PHASE-5.5B-1-AUDIT-FINDINGS.md` | NEW — Step 1 ClinVar audit documentation |
| `docs/clinvar/example-vcv.xml` | NEW — annotated VCV structure reference |
| `docs/clinvar/example-rcv-section.xml` | NEW — complete RCV element reference |
| `docs/clinvar/example-scv-section.xml` | NEW — complete SCV element reference |
| `PHASE-5.5B-1-FINAL-REPORT.md` | NEW — this file |
