# ResearchCoPilot — Phase R Gene Resolution Fix Analysis Report

**Report date:** 2026-10-27  
**Scope:** evidence consolidation and Candidate A design evaluation only  
**Implementation status:** No production fix has been implemented or verified

## Current Consolidated Findings

This section is authoritative for the current investigation. Earlier conclusions that conflict with the live runtime evidence are retained below only as historical findings and are explicitly marked superseded.

- **LIVE-VERIFIED:** `resolveQuery("UBB")` returned human UBB, Gene ID `7314`, confidence `0.92`; `resolveQuery("ubb")` returned no gene, organism, or disease and confidence `0.30`.
- **LIVE-VERIFIED:** `resolveQuery("EGFR")` returned human EGFR, Gene ID `1956`, confidence `0.92`; `resolveQuery("egfr")` returned a disease result with confidence `0.72`.
- **LIVE-VERIFIED:** `tp53` resolved to human TP53, Gene ID `7157`; `Trp53` resolved to mouse Trp53, Gene ID `22059`; `TP53 breast cancer` preserved both gene and disease context.
- **CODE-INSPECTED:** the primary candidate-selection restriction is in `artifacts/research-copilot/lib/resolver/index.ts` around lines 300–304. A second bare-query guard is in `artifacts/research-copilot/lib/resolver/gene.ts` around lines 140–149.
- **LIVE-VERIFIED:** MedGen ESearch returned 348 results for `egfr`, zero for `ubb`, and 1,908 for `breast` in the captured probe.
- **LIVE-VERIFIED:** NCBI returned `querytranslation: "egfr[All Fields]"`; this does not show an explicit rewrite of the query to `eGFR`.
- **CODE-INSPECTED:** the disease resolver may accept a non-exact MedGen result based on semantic type without verifying that the selected title is relevant to the submitted query. This is a separate issue from gene-candidate recognition.
- **PREDICTED / NOT-VERIFIED:** Candidate A below has not been implemented, run through the complete literal matrix, or validated against mocked/live responses for every required input.

## Verification Summary

| Claim or test | Evidence | Current result | Evidence label |
|---|---|---|---|
| `UBB` vs `ubb` | Codespaces resolver runtime | `UBB` → Gene ID 7314; `ubb` → unresolved, confidence 0.30 | LIVE-VERIFIED |
| `EGFR` vs `egfr` | Codespaces resolver runtime | `EGFR` → Gene ID 1956; `egfr` → disease, confidence 0.72 | LIVE-VERIFIED |
| `tp53` | Codespaces resolver runtime | Human TP53, Gene ID 7157 | LIVE-VERIFIED |
| `Trp53` | Codespaces resolver runtime | Mouse Trp53, Gene ID 22059 | LIVE-VERIFIED |
| `TP53 breast cancer` | Codespaces resolver runtime | Both gene and disease context present | LIVE-VERIFIED |
| Main gene candidate gate | Source inspection | Digit is required for the lower/mixed-case fallback | CODE-INSPECTED |
| Direct `resolveGene()` gate | Source inspection | Similar digit requirement | CODE-INSPECTED |
| MedGen `egfr` search | Raw ESearch/ESummary output | 348 results; first four displayed summaries are CKD grade records typed as `Finding` | LIVE-VERIFIED |
| MedGen `ubb` search | Raw ESearch output | Count 0, no IDs, output message `No items found.` | LIVE-VERIFIED |
| MedGen `breast` search | Raw ESearch/ESummary output | 1,908 results; first result is a congenital breast-absence concept | LIVE-VERIFIED |
| Candidate A full regression matrix | Not executed | Needs additional evidence; no candidate implementation exists to run | PREDICTED / NOT-VERIFIED |

## 1. Repository Baseline and Scope

The latest baseline reported from the user's Codespaces terminal was:

- **Branch:** `phase-r-gene-resolution-fix-20261016`
- **HEAD:** `3f7db2b94b623e82792424844d3d3f60ac9e8570`

The latest user-provided `git status --short` showed pre-existing changes in:

```text
 M artifacts/research-copilot/.replit-artifact/artifact.toml
 M artifacts/research-copilot/package.json
 M pnpm-lock.yaml
?? AUDIT-REPORT.md
?? PHASE-R-GENE-RESOLUTION-FIX-REPORT.md
?? artifacts/research-copilot/app/api/protein/structure/
?? artifacts/research-copilot/lib/protein/structure-fetch.ts
?? artifacts/research-copilot/types/protein-structure.ts
```

These existing files and changes must be preserved. This report is a locally prepared replacement artifact; it has not been written to the user's Codespaces filesystem or pushed to GitHub. No GitHub write, commit, or push was performed as part of this report preparation.

## 2. Root Cause: Gene Candidate Gates

### 2.1 Main resolver gate

In `artifacts/research-copilot/lib/resolver/index.ts`, around lines 300–304, the source contains:

```ts
const wholeStringCandidate = GENE_SYMBOL_RE.test(q)
  ? q
  : GENE_SYMBOL_RE.test(q.toUpperCase()) && /\d/.test(q)
  ? q
  : null;
```

**CODE-INSPECTED:** For lowercase alphabetic `ubb` and `egfr`, the uppercased form fits the shape, but the `/\d/.test(q)` requirement is false. Consequently, `wholeStringCandidate` is `null`, and the single-token query does not enter the normal whole-string `resolveGene()` path.

### 2.2 Direct gene resolver guard

In `artifacts/research-copilot/lib/resolver/gene.ts`, around lines 140–149, the source contains:

```ts
const isMixedCaseBareCandidate =
  !GENE_SYMBOL_RE.test(trimmedOriginalCase) &&
  GENE_SYMBOL_RE.test(trimmedOriginalCase.toUpperCase()) &&
  /\d/.test(trimmedOriginalCase);
if (
  !detectedOrganism &&
  !GENE_SYMBOL_RE.test(trimmedOriginalCase) &&
  !isMixedCaseBareCandidate
)
  return null;
```

**CODE-INSPECTED:** This is a second restriction affecting direct bare calls to `resolveGene()` without an explicit organism. Candidate design must account for both gates; changing only one would leave the other restriction in place.

### 2.3 Disease fallback

In `index.ts` around lines 395–402, if no gene or organism was accepted, the pipeline checks `isBareLikelyGeneSymbol`. That condition also requires a digit. For `ubb` and `egfr`, the condition is false; if no organism was resolved, the pipeline sets `diseaseQuery` to the query and calls `resolveDisease()`.

**Important distinction:** a gene candidate passing a regex is not proof of gene identity. The returned official symbol and organism must be validated before a gene is accepted.

## 3. MedGen Partial-Match Mechanism

### 3.1 Raw ESearch evidence

The captured NCBI output for `egfr` was:

```json
{
  "query": "egfr",
  "count": "348",
  "querytranslation": "egfr[All Fields]",
  "ids": [
    "1892326",
    "1892325",
    "1892324",
    "1892323",
    "1884981"
  ]
}
```

The captured NCBI output for `ubb` was:

```json
{
  "query": "ubb",
  "count": "0",
  "querytranslation": "(ubb[All Fields])",
  "ids": [],
  "warninglist": {
    "phrasesignored": [],
    "quotedphrasesnotfound": [],
    "outputmessages": [
      "No items found."
    ]
  }
}
```

The captured `breast` probe returned count `1908` and these first five IDs: `1895736`, `1895732`, `1895731`, `1895476`, `1893510`.

**LIVE-VERIFIED:** `egfr[All Fields]` does not demonstrate an explicit query rewrite. The probe proves that this search returned the listed results, not why NCBI matched every indexed field.

### 3.2 Source selection logic

In `artifacts/research-copilot/lib/resolver/disease.ts`, around lines 142–149, `resolveDisease()` sends a query to MedGen ESearch with `retmax=5` and returns `null` when count or IDs are empty.

Around lines 165–181, the resolver:

1. Looks for an exact case-insensitive title match.
2. Otherwise selects the first result accepted by `isDiseaseSemanticType()`.
3. Assigns confidence `0.85` to an exact title match and `0.72` otherwise.

The local selection code does not apply a substring or edit-distance comparison between the original query and selected title. The external ESearch results are broad, and the local resolver can accept a semantically typed result even when the title does not meaningfully correspond to the query.

`isDiseaseSemanticType()` around lines 116–125 permits configured types including `Finding` and `Congenital Abnormality`. It also treats missing or unknown semantic types permissively.

### 3.3 Meaning of the observed results

**`egfr` — LIVE-VERIFIED:** the first four displayed summaries were Grade 1–4 Chronic Kidney Disease, CTCAE 6.0, each classified as `Finding`; the fifth was `EGFR NP_005219.2:p.E709X`, typed as `Cell or Molecular Dysfunction`. The displayed titles were not exact matches for the single-token query `egfr`.

**`ubb` — LIVE-VERIFIED:** the specific MedGen query returned zero results, so `resolveDisease()` returned `null`. This does not prove that no UBB-related records exist anywhere in MedGen.

**`breast` — LIVE-VERIFIED:** the first summary was “Congenital absence of mammary gland with normal nipple-areolar complex,” typed as `Congenital Abnormality`; other displayed records concerned breast agenesis, abnormal examination, and implant malfunction. The single word `breast` is retained as the query's normalized value in a partial match, even though it is not an exact concept title.

**PREDICTED / NOT-VERIFIED:** the eGFR/CKD terminology overlap is a plausible reason the broad MedGen search returned CKD records, and the first CKD record's definition contains eGFR terminology. The actual `querytranslation` did not explicitly rewrite `egfr` to `eGFR`; the precise search expansion/ranking mechanism has not been established.

### 3.4 Confidence derivation

In `disease.ts` around line 181, a partial disease result receives `0.72`. In `artifacts/research-copilot/lib/resolver/index.ts` around lines 112–119, `computeConfidence([])` returns `0.3`, while one accepted disease result at `0.72` with no other accepted entity leaves the overall confidence at `0.72`.

The disease-classification issue is separate from lowercase gene-candidate recognition and remains out of Candidate A's implementation scope.

## 4. Historical Investigation — Retained but Superseded

An earlier investigation pass was performed in an environment that could not execute the resolver or make NCBI requests. It reported the runtime state as unavailable and incorrectly reasoned that identical control flow should yield identical results for `ubb` and `egfr`.

That conclusion is **superseded** by the subsequent Codespaces runtime and MedGen probes captured on 2026-10-27. Those probes directly showed different results: `ubb` unresolved at `0.30`, `egfr` disease-classified at `0.72`. Different query strings can produce different external search results even when they enter the same fallback function.

The earlier source snippets in the raw historical report were also corrupted by copy/paste formatting (`/\d/` appeared as an HTML-entity fragment). The current source excerpts in this report reproduce the inspected code accurately.

Historical value retained: the earlier pass correctly identified that (a) the gene candidate restriction needed scrutiny, (b) normalized-query assignment alone does not validate entity identity, and (c) runtime evidence was needed before approving a fix.

## 5. Candidate A — Design to Evaluate, Not Implemented

**Candidate A: case-insensitive bare-symbol gate with strict validation for alphabetic case variants.** This is a proposal, not an implemented change.

1. Both candidate gates would permit a single-token, 2–13-character ASCII letters/digits string whose uppercased form matches the existing gene-symbol shape. A digit would not be required merely for candidate eligibility. The input's original case would be preserved.
2. The new strict-validation rule would apply only to newly admitted bare candidates made entirely of ASCII letters and containing at least one lowercase letter. For this path, the NCBI Gene record's official current symbol must match the input case-insensitively.
3. In this newly admitted alphabetic-only path, neither the human-first branch nor the non-human fallback may accept the first search result solely because results exist. If no official-symbol match is found, the candidate is rejected as a gene.
4. Digit-containing inputs such as `p53`, `tp53`, and `Trp53` remain on their existing path unless evaluation identifies a specific regression that requires a separately justified change.
5. No hardcoded gene-symbol list or broad common-word blocklist is introduced. Disease-classification code remains out of scope.

### Candidate A risks to test

- A query can pass the shape check without being a gene; shape is only a retrieval gate.
- NCBI `[sym]` searches can return aliases and non-exact hits; the new alphabetic-only path must validate official current symbol rather than accept `entries[0]`.
- Exact current-symbol validation may alter lowercase alias behavior for gene symbols that are valid aliases but not current official symbols. Those behavior changes need identification.
- Common words can theoretically collide with official symbols in a non-human organism. An official-symbol match is stronger evidence but does not, by itself, prove user intent in every context.
- The interaction between candidate detection, organism disambiguation, rate limits, and human-first fallback must be validated with current results.

## 6. Literal Evaluation Matrix

**How to read this matrix:** `LITERAL-EVALUATED` means the proposed rule was applied logically to the input shape and stated acceptance condition. It does **not** mean the candidate was executed. No Candidate A source implementation exists, so candidate output and API-dependent matches remain unverified. The design remains blocked unless the required matrix is tested with suitable evidence.

### 6.A Nine gene symbols — uppercase and lowercase (18 required inputs)

| Input | Expected gene / NCBI Gene ID | Current observed result | Candidate A literal route | Candidate evaluation | Evidence |
|---|---|---|---|---|---|
| `UBB` | UBB / 7314 | UBB / 7314, human, 0.92 | Existing all-uppercase path unchanged | Expected path preserved; regression test still required | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `ubb` | UBB / 7314 | Unresolved, 0.30 | Newly admitted alphabetic-only path; require official symbol UBB | Expected if an official match is returned; must be run against NCBI/current harness | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `EGFR` | EGFR / 1956 | EGFR / 1956, human, 0.92 | Existing all-uppercase path unchanged | Expected path preserved; regression test still required | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `egfr` | EGFR / 1956 | Disease, 0.72 | Newly admitted alphabetic-only path; require official symbol EGFR; accepted gene should suppress bare-query disease fallback | Expected if official match is returned; full pipeline must be rerun | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `TP53` | TP53 / 7157 | TP53 / 7157, human, 0.92 | Existing all-uppercase path unchanged | Expected path preserved; regression test still required | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `tp53` | TP53 / 7157 | TP53 / 7157, human, 0.92 | Digit-containing existing path unchanged | Expected to remain unchanged; test required | LIVE-VERIFIED current; candidate PREDICTED / NOT-VERIFIED |
| `BRCA1` | BRCA1 / 672 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `brca1` | BRCA1 / 672 | Not tested in the captured runtime matrix | Digit-containing existing path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `ACTB` | ACTB / 60 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `actb` | ACTB / 60 | Not tested in the captured runtime matrix | Newly admitted alphabetic-only path; require official symbol ACTB | Need verify official-symbol match and returned ID | PREDICTED / NOT-VERIFIED |
| `GAPDH` | GAPDH / 2597 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `gapdh` | GAPDH / 2597 | Not tested in the captured runtime matrix | Newly admitted alphabetic-only path; require official symbol GAPDH | Need verify official-symbol match and returned ID | PREDICTED / NOT-VERIFIED |
| `ALB` | ALB / 213 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `alb` | ALB / 213 | Not tested in the captured runtime matrix | Newly admitted alphabetic-only path; require official symbol ALB | Need verify official-symbol match and returned ID | PREDICTED / NOT-VERIFIED |
| `INS` | INS / 3630 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `ins` | INS / 3630 | Not tested in the captured runtime matrix | Newly admitted alphabetic-only path; require official symbol INS | Need verify official-symbol match and returned ID | PREDICTED / NOT-VERIFIED |
| `CFTR` | CFTR / 1080 | Not tested in the captured runtime matrix | Existing all-uppercase path unchanged | Need current baseline result and post-candidate regression test | PREDICTED / NOT-VERIFIED |
| `cftr` | CFTR / 1080 | Not tested in the captured runtime matrix | Newly admitted alphabetic-only path; require official symbol CFTR | Need verify official-symbol match and returned ID | PREDICTED / NOT-VERIFIED |

**Section result:** The candidate's intended behavior is logically specified, but the complete set of 18 inputs has not been executed through an implementation. The matrix is not a runtime pass.

### 6.B Species and compatibility cases

| Input | Required behavior | Candidate A assessment | Evidence / status |
|---|---|---|---|
| `Trp53` | Mouse Trp53 / 22059 | Digit-containing input remains on existing species-case path | Current baseline is LIVE-VERIFIED; candidate non-regression PREDICTED / NOT-VERIFIED |
| `p53` | Preserve existing alias behavior, reported previously as human TP53 / 7157 | Digit-containing input remains on existing path | Exact current baseline and candidate non-regression need verification; PREDICTED / NOT-VERIFIED |
| `BRCA` | Preserve existing ambiguity behavior | Candidate applies no new alphabetic-only lowercase rule to all-uppercase `BRCA`; strict exact-match change should not affect it | Baseline behavior must be re-run; PREDICTED / NOT-VERIFIED |
| `COX1` | Preserve existing ambiguity behavior | Digit-containing input remains on existing path | Baseline behavior must be re-run; PREDICTED / NOT-VERIFIED |
| `TP53 breast cancer` | Keep both TP53 gene and breast cancer disease context | Embedded-token path should remain unchanged; verify after any gate changes | Current baseline LIVE-VERIFIED; candidate non-regression PREDICTED / NOT-VERIFIED |

### 6.C Disease terms

The candidate's gene field must remain null for these inputs unless NCBI establishes a valid official-symbol match and the application has sufficient evidence that the input is intended as a gene. Existing disease behavior must be recorded separately; Candidate A does not modify `disease.ts`.

| Input | Expected gene field | Candidate A assessment | Evidence / status |
|---|---|---|---|
| `breast cancer` | null | Multiword input should not be accepted as a bare gene; verify disease output separately | PREDICTED / NOT-VERIFIED |
| `diabetes` | null | Alphabetic-only candidate gate would admit shape; strict official-symbol validation must reject unless a true symbol/intent collision exists | PREDICTED / NOT-VERIFIED |
| `malaria` | null | Same strict validation requirement | PREDICTED / NOT-VERIFIED |
| `leukemia` | null | Same strict validation requirement | PREDICTED / NOT-VERIFIED |
| `cancer` | null | Same strict validation requirement | PREDICTED / NOT-VERIFIED |
| `tuberculosis` | null | Same strict validation requirement | PREDICTED / NOT-VERIFIED |

### 6.D Ordinary words

The key safety requirement is that passing the candidate gate does not make a word a gene. Each input needs actual source/API evaluation because some words may collide with symbols or aliases, including in non-human organisms.

| Input | Expected gene field | Candidate A rule | Candidate evaluation | Evidence / status |
|---|---|---|---|---|
| `breast` | null unless intended official gene match is justified | Reject if no official symbol match; do not count MedGen result as gene evidence | Existing baseline returns disease partial; candidate route/API behavior untested | LIVE-VERIFIED current disease result; candidate PREDICTED / NOT-VERIFIED |
| `table` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `happy` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `money` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `purple` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `garden` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `window` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `yellow` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `pocket` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `protein` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `chair` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `orange` | null unless justified | Official-symbol validation required; investigate possible symbol collisions rather than assume | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |
| `apple` | null unless justified | Official-symbol validation required | Actual cross-organism symbol-search result not checked | PREDICTED / NOT-VERIFIED |

**Section result:** Candidate A has not been shown to satisfy the entire ordinary-word matrix. Exact-symbol validation narrows the false-positive risk but does not logically guarantee that a common word can never coincide with an official symbol in any organism. These rows require explicit evaluation.

## 7. Candidate A Assessment

Candidate A is a concrete, falsifiable design and is safer than merely removing the digit restriction because it adds official-symbol validation on the newly admitted alphabetic-only path. It also correctly scopes the `p53`, `tp53`, and `Trp53` cases outside that newly admitted path.

However, it is **not yet demonstrated to pass** the literal matrix:

1. The candidate has not been implemented, so there is no executable candidate to run through the complete table.
2. The eight additional uppercase/lowercase pairs besides the already-tested examples have not been evaluated in the live resolver harness as candidate behavior.
3. The disease-term and ordinary-word checks have not established which inputs have official-symbol collisions or what the complete cross-organism candidate behavior would be.
4. Alias compatibility and any possible common-word/official-symbol collisions remain unresolved.
5. The MedGen partial-match classification is an independent issue and must not be changed as part of Candidate A.

No row should be counted as a candidate runtime pass solely because the proposed regex admits it or because the written acceptance rule sounds safe.

## 8. Required Next Evidence

Before the status may be changed, evaluate Candidate A using a deterministic mocked harness where feasible, and live API/runtime tests where needed. Clearly distinguish mocked results from live results. At minimum, the full matrix in Section 6 must have a recorded outcome for every input, including the 18 uppercase/lowercase gene-symbol cases, species and compatibility cases, disease terms, and all 13 ordinary words.

Any behavior changes for `p53`, aliases, ambiguity, or cross-organism symbols must be explicitly documented. If a common word produces an exact official-symbol match in any organism, the design must state how user intent is protected without adding a broad hardcoded blocklist.

## Final Design Status

**DESIGN BLOCKED — MORE EVIDENCE REQUIRED**

### Remaining blockers

1. **Candidate matrix not completed:** Candidate A has been defined and logically inspected, but has not passed a complete executable or adequately evidenced literal matrix. Most candidate outcomes remain `PREDICTED / NOT-VERIFIED`.
2. **Ordinary-word collisions not evaluated:** Exact official-symbol validation is necessary but may not be sufficient to establish intent when a common word overlaps with a gene symbol in another organism.
3. **Compatibility still needs regression evidence:** `p53`, `BRCA`, `COX1`, `Trp53`, and embedded multi-entity behavior must be tested against candidate behavior, not merely predicted from the proposed rules.

### Decision

The root cause and the current MedGen search outcomes are sufficiently traced to evaluate a concrete candidate, but they do not establish that Candidate A is safe across the required inputs. Keep the status blocked. Do not implement production changes until the required candidate-evaluation matrix is complete and the design passes the stated acceptance criteria.

No production source code was changed during preparation of this report artifact.