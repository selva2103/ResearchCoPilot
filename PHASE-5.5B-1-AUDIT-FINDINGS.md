# Phase 5.5B-1 — ClinVar Deeper-Retrieval Audit Findings

**Date:** 2026-07-21  
**Purpose:** Step 1 mandatory audit for Phase 5.5B-1 (Clinical Evidence Foundation).  
**Test variant:** VCV004685939 — TP53 germline variant, 2 RCVs, 2 SCVs  
**Reference files:** `docs/clinvar/example-vcv.xml`, `example-rcv-section.xml`, `example-scv-section.xml`

---

## Decision Log — Retrieval Surfaces Evaluated

| Surface | Decision | Reason |
|---|---|---|
| **ESummary** (`esummary.fcgi?db=clinvar`) | ❌ Rejected for SCV/RCV data | Returns basic variant identity fields (accession, title, type, significance label, 0–1 consequences). No RCV-level condition interpretations, no SCV submission detail, no submitter. Used in Phase 5.5A for variant list only. |
| **EFetch VCV XML** (`efetch.fcgi?db=clinvar&rettype=vcv&id=VCV{acc}&retmode=xml`) | ✅ Accepted | Contains complete `RCVList` (per-condition interpretations) and `ClinicalAssertionList` (individual SCVs) in a single response. All required fields present. |
| **EFetch VCV JSON** (`rettype=vcv&retmode=json`) | ❌ Rejected | `retmode=json` is silently ignored — the endpoint always returns XML. Confirmed by live call: response `Content-Type` is `text/xml` regardless of `retmode=json`. No JSON mode exists for VCV EFetch. |
| **RCV-level ESummary** (`esummary.fcgi?db=clinvar&id=RCV...`) | ❌ Rejected | Returns `"Invalid uid"` error for RCV accessions. ESummary db=clinvar indexes Variation IDs (VCV numeric UIDs), not RCV accessions. RCVs cannot be fetched via ESummary. |
| **Dedicated ClinVar REST API** (`api.ncbi.nlm.nih.gov/clinvar/v0/variation/...`) | ❌ Rejected | Endpoint returns HTTP 404. Not live as of 2026-07-18 (confirmed in 5.5A fix session). NCBI's newer ClinVar variation API (`clinvar.ncbi.nlm.nih.gov/api/...`) was also checked — requires authentication and is intended for the ClinVar web application, not public E-utility use. |
| **Bulk FTP flat files** (`variant_summary.txt`, `submission_summary.txt`) | ❌ Explicitly ruled out | These are large periodic bulk downloads (updated weekly) designed for offline ETL/ingestion pipelines. They are not suitable for per-variant on-demand API calls. Using them here would violate this phase's on-demand/volume-safe design. They remain a theoretical option ONLY for a separate scheduled bulk-ingestion architecture — which is entirely out of scope for this phase and is not being proposed. |

**Chosen surface:** `efetch.fcgi?db=clinvar&rettype=vcv&id=VCV{accession}&retmode=xml`  
**Required ID format:** VCV-prefixed string (e.g. `VCV004685939`). Numeric-only IDs return an empty `<set/>` response with no error status — must be detected and rejected explicitly.

---

## Finding 1 — VCV XML Contents

The `VariationArchive` element contains a `ClassifiedRecord` with two key children:

**`RCVList`** — per-condition interpretations:
- Each `RCVAccession` element corresponds to one ClinVar RCV accession
- Contains `ClassifiedConditionList` → `ClassifiedCondition` elements (condition name + `DB`/`ID` attributes for MedGen CUI, OMIM, MONDO)
- Contains `RCVClassifications` → `GermlineClassification` → `ReviewStatus` (plain text) + `Description` (classification text with `@SubmissionCount` and `@DateLastEvaluated` attributes)

**`ClinicalAssertionList`** — individual SCV submissions:
- Each `ClinicalAssertion @ContributesToAggregateClassification` element is one submission
- `ClinVarAccession @Type="SCV" @Accession @SubmitterName` — SCV identifier + submitter name
- `Classification @DateLastEvaluated` → `ReviewStatus` + `GermlineClassification`
- `TraitSet/Trait/XRef @DB @ID` — database cross-references (MedGen CUI primary) for SCV→RCV mapping
- `ClinVarSubmissionID @localKey` — fallback for MedGen CUI extraction when XRef is absent (format: `{id}|MedGen:{CUI}`)

---

## Finding 2 — SubmissionCount (cheap vs. full-fetch cost)

`SubmissionCount` is a **native attribute** on the `<Description>` element within each RCV's `GermlineClassification` section:

```xml
<Description SubmissionCount="3" DateLastEvaluated="2024-11-04">Pathogenic</Description>
```

This attribute is available without fetching individual SCVs. However, the full SCV list (`ClinicalAssertionList`) is always present in the same VCV EFetch response body — there is no way to fetch only the count without also receiving the SCVs.

**Design decision (per Step 5's explicit rule):** Since obtaining `submissionCount` requires the same HTTP response that delivers the full SCV list, the cost of fetching submissions is always paid upfront. Submissions are stored immediately. The "expand submissions" affordance in the UI is a **UI-only show/hide toggle**, not a deferred network call.

---

## Finding 3 — SCV → RCV Mapping Strategy

SCVs in `ClinicalAssertionList` do not have direct `@RCVAccession` attributes. Mapping is via condition identity:

1. **Primary:** Extract MedGen CUI from `TraitSet/Trait/XRef @DB="MedGen" @ID`
2. **Fallback:** Parse `ClinVarSubmissionID @localKey` (format `{id}|MedGen:{CUI}`) when XRef is absent
3. **Single-RCV fallback:** If only one RCV exists and MedGen mapping fails, assign SCV to the single RCV
4. **Unmatched SCVs:** If >1 RCV and no MedGen match, SCV is preserved with `conditionAsserted=null`

**Known limitation:** Old retired submissions may use OMIM-keyed XRefs with no MedGen reference. These are unlinked under the multi-RCV fallback. This affects a small fraction of older submissions and is documented as a known limitation.

---

## Finding 4 — Multiple RCVs / Overlapping Conditions

Tested with VCV004685939 (TP53), which has 2 RCVs for distinct conditions. ClinVar provides distinct RCV accessions with separate aggregate classifications per condition. The model preserves these as separate `ConditionInterpretation` entries — **never merged**, even when condition names appear conceptually related. ClinVar's raw wording is preserved exactly.

---

## Finding 5 — Real-World Quirks Documented

| Quirk | Handling |
|---|---|
| Multiple RCVs on one variant | Preserved as separate `ConditionInterpretation` entries |
| Overlapping/near-duplicate condition names | Preserved verbatim — never merged |
| Zero interpretations (variant with no formal review) | Returns `ClinicalEvidence { interpretations: [] }` — not an error, not null |
| Malformed/missing `ClassifiedRecord` | `parseClinVarVCVXml` returns null; route reports as PARSE_FAILED error |
| Individual RCV parse failure | `parseRCVAccession` returns null (try/catch); other RCVs still parsed |
| SCV with no MedGen XRef and >1 RCV | `conditionAsserted = null`; SCV preserved but unlinked |
| `ContributesToAggregateClassification="false"` | Parsed and preserved as `contributesToAggregate: false` |

---

## Finding 6 — Review Status Text Values (Observed)

Values confirmed from live ClinVar data (needed for 5.5B-2 star mapping):

| Text | Stars (5.5B-2) |
|---|---|
| `no assertion criteria provided` | 1 |
| `no classification provided` | 0 |
| `criteria provided, single submitter` | 1 |
| `criteria provided, multiple submitters, no conflicts` | 2 |
| `criteria provided, conflicting classifications` | 1 |
| `reviewed by expert panel` | 3 |
| `practice guideline` | 4 |

(Star mapping is NOT built in 5.5B-1 — plain text only.)

---

## Reference Files

- `docs/clinvar/example-vcv.xml` — Trimmed VariationArchive with annotated structure overview and first RCVAccession block
- `docs/clinvar/example-rcv-section.xml` — Complete first RCVAccession element from VCV004685939
- `docs/clinvar/example-scv-section.xml` — Complete first ClinicalAssertion (SCV) element from VCV004685939
