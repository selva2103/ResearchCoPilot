# Phase 5.6C Final Report — Hardening for Phase 5.6 (Biological Function Explorer)

**Date:** 2026-07-30  
**Branch:** main  
**Scope:** Hardening, validation, and bug-fix for Phase 5.6A (GO Foundation) + 5.6B (Pathway Integration). No new features introduced.

---

## Final Checklist

- [x] Repository state verified; `main` confirmed canonical; remote hash verified after push
- [x] End-to-end validation passes, including GO/Pathways cohesion check
- [x] Cross-species validation passes for both GO and pathway data
- [x] Downloads and Phase 5.5 features confirmed unaffected
- [x] All 5 error-state cases pass
- [x] Performance/cache verification passes with actual evidence, including TP53→BRCA1→TP53 test
- [x] API compatibility audit passes with no undocumented contract changes
- [x] No regressions; one confirmed bug found and fixed (cross-species pathway leakage)
- [x] TypeScript passes with zero errors (before and after fix)
- [x] `PHASE-5.6C-FINAL-REPORT.md` written
- [x] `v5.6-complete` tag created and verified on remote
- [x] Phase 5.7 can begin cleanly from this state

---

## Step 0 — Repository State Verification

**Branch:** `main` (single HEAD commit — grafted shallow clone from GitHub import)  
**HEAD commit:** `bfcd1ac` (Phase 5.6C fix) ← `621a234` (Phase 5.6A + 5.6B combined)  
**Working tree:** Clean (confirmed `git status` before and after fix)  
**Tracking:** `origin/main`

**Fetch result:** `git fetch --all` pulled full remote history including:
- `origin/phase-5.5a-work`, `origin/phase-5.5b-2-work` — prior feature branches, already merged to main
- `v5.4-complete` tag fetched locally
- `v5.5-complete` tag confirmed on remote via `git ls-remote --tags origin`

**Tag verification:**
```
git ls-remote --tags origin | grep "v5\."
e3230bb  refs/tags/v5.4-complete
f0a8b5e  refs/tags/v5.5-complete   ← v5.5-complete on remote confirms main is canonical
```

**Branch consolidation:** Not required. Phase 5.6A and 5.6B were committed directly to `main` in a single combined commit (`621a234`). No divergent branches existed to merge.

**PHASE-5.6A-FINAL-REPORT.md:** Present and verified — describes GO Foundation implementation, four-gene audit (TP53/BRCA1/CFTR/Trp53), parser strategy, and completion checklist.

**PHASE-5.6B-FINAL-REPORT.md:** Present and verified — describes Pathway Integration, Reactome Analysis Service audit, source comparison (NCBI ELink ~7% vs Reactome 100%), and PathwayMembership contract.

---

## Step 1 — End-to-End Validation and Cohesion Review

### 1.1 Full chain: Resolver → GeneID → Gene → FunctionalAnnotation → PathwayMembership (TP53)

| Stage | Observed Evidence |
|---|---|
| Resolver | `/api/resolve-validate`: geneId=7157, symbol=TP53, organism=Homo sapiens, confidence=0.92 |
| GO endpoint | `/api/gene/go` POST: status=success, count=208, source=ncbi-gene-xml, geneId=7157, organism=Homo sapiens |
| Pathway endpoint | `/api/gene/pathways` POST: status=success, count=129, source=reactome, all geneId=7157 |
| Identifier immutability | geneId/geneSymbol/organism consumed from request; no re-derivation in go-fetch.ts, go-parser.ts, or pathway-fetch.ts — confirmed by code inspection |

**GO breakdown for TP53:** MF=53, BP=117, CC=38 (total 208; multiple evidence codes per term preserved per design)  
**Pathways for TP53 (after 5.6C fix):** 129 R-HSA-* (Homo sapiens), 8 disease-flagged

### 1.2 Cohesion Check — GO sections + Pathways section render coherently

**BiologicalFunctionPanel.tsx** (787 lines) implements both sections in a single "Biological Function" panel:
- **Gene Ontology subsection:** three collapsible AspectSection cards (Molecular Function/violet, Biological Process/emerald, Cellular Component/sky), with consistent rounded-lg border styling, per-group count badges, "Show N more" pagination (20/page), and inline evidence code tooltips
- **Pathways subsection:** collapsible PathwaysSection with orange color scheme, Reactome source header badge, row-level disease flags, same "Show N more" pagination pattern
- **Lazy load:** both fetches triggered simultaneously on first panel open (`handleToggle` fires both `fetchGoAnnotations` and `fetchPathways` when `goState === "idle"` and `pathwayState === "idle"`)
- **Independent loading states:** GO and Pathway each have separate `state` / `errorMessage` / `isRateLimit` state variables — one loading does not block or affect the other
- **Consistent styling:** both sections use `text-xs` body text, `rounded-full` count badges, `SmallSpinner` for loading, amber retry button — visually coherent throughout

**Assessment: CONSISTENT.** No visual or structural inconsistency found.

### 1.3 Gene with GO annotations and pathway memberships from multiple sources

Phase 5.6B confirmed WikiPathways is inaccessible (HTTP 404/406 from all endpoints). Only Reactome is active. Duplicate/overlapping pathway suppression is by `pathwayId` literal equality only — no name-similarity merging (confirmed in code). Source attribution is always set to `"reactome"` with the Reactome PathwayBrowser `sourceUrl`. No merging issue possible with a single source.

### 1.4 Independent empty states

- Gene with GO but zero pathways: **Tp53/rat** (geneId=24842) — GO count=304, pathway count=0 → PathwaysSection shows "No Reactome pathway memberships found for Tp53." GoAnnotationsSection unaffected ✓
- Gene with pathways but zero GO: Not observed in tested genes. The `status=empty` branch in GoAnnotationsSection renders "No Gene Ontology annotations found for {symbol} in NCBI Gene." independently of pathway state ✓

---

## Step 2 — Cross-Species Validation

### 2.1 Bare symbol resolution results

| Query | GeneID | Organism | GO count | Pathway count | All correct species? |
|---|---|---|---|---|---|
| TP53 | 7157 | Homo sapiens | 208 | 129 | ✅ All R-HSA-* |
| Trp53 | 22059 | Mus musculus | 395 | 51 | ✅ All R-MMU-* |
| Tp53 | 24842 | Rattus norvegicus | 304 | 0 | ✅ Reactome has no R-RNO-* coverage for Tp53 |

**GO cross-species coverage for model organisms:** Confirmed — NCBI Gene EFetch XML provides GO annotations for Mus musculus (395 terms for Trp53) and Rattus norvegicus (304 terms for Tp53) via GOA. Not NCBI-human-only.

**Reactome cross-species coverage:** Confirmed for Mus musculus (51 R-MMU-* pathways for Trp53). Rattus norvegicus has no Reactome pathway coverage for Tp53 (correctly returns empty, not "unsupported"). Rat coverage in Reactome is limited by design — this is correct behavior.

### 2.2 Cross-species data leakage — Bug found and fixed

**Bug:** `toPathwayMemberships()` did not filter by the query gene's organism. Reactome Analysis Service returns cross-species orthologs by default. For human TP53 (`organism="Homo sapiens"`), the raw Reactome response contained 180 pathways: 129 R-HSA-* (Homo sapiens) + 51 R-MMU-* (Mus musculus).

**Root cause:** `getGenePathways(geneId, geneSymbol, organism)` accepted `organism` but did not pass it to `toPathwayMemberships`.

**Fix (Phase 5.6C, commit `bfcd1ac`):** Added `organism` parameter to `toPathwayMemberships` and filtered with:
```typescript
if (p.species.name !== organism) continue;
```
Exact case-sensitive comparison is correct — Reactome species names are always fully qualified.

**After fix:**
- TP53 (Homo sapiens): 129 pathways, all R-HSA-*, `organisms: {'Homo sapiens': 129}` ✓
- Trp53 (Mus musculus): 51 pathways, all R-MMU-*, `organisms: {'Mus musculus': 51}` ✓

**GO section:** No cross-species leakage possible — GO annotations keyed by NCBI GeneID (species-specific). Verified: Trp53 data contains only `geneSymbol=Trp53, organism=Mus musculus`; Tp53 data contains only `organism=Rattus norvegicus`.

---

## Step 3 — Download & Existing-Feature Validation

| Feature | Test | Result |
|---|---|---|
| Transcript FASTA download | GET `/api/transcript/download?accession=NM_000546.6&type=fasta` | HTTP 200 ✅ |
| Protein FASTA download | GET `/api/protein/download?accession=NP_000537.3` | HTTP 200 ✅ |
| Gene FASTA download | GET `/api/gene/fasta?accession=...` (genomic coords from GeneRecord) | Route unchanged from prior phase; GET method confirmed |
| Variant list (Phase 5.5A) | POST `/api/variant/list` {geneId:"672", taxonomyId:"9606"} | status=success, module=clinvar-variants ✅ |
| Clinical evidence (Phase 5.5B) | POST `/api/clinical-evidence` {clinvarVariationId:"17661"} | status=success ✅ |
| VariantResearchContext route | `/api/variant/research-context` exists | Route file present, unchanged ✅ |

**Phase 5.6 changes to these routes:** None. No modification to any Phase 5.1–5.5 file.

---

## Step 4 — Error-State Testing

All 5 scenarios:

| # | Scenario | Expected | Observed |
|---|---|---|---|
| 1 | Non-existent gene (geneId=99999999) | clean empty state | status=empty, count=0, error=null (both GO and Pathways) ✅ |
| 2 | Gene with no GO annotations (GDPD3, geneId=284083) | explicit empty | status=empty, count=0 ✅ |
| 3 | Gene with no pathway memberships (Tp53/rat, geneId=24842) | explicit empty | status=empty, count=0; GO unaffected (count=304) ✅ |
| 4 | Rate limit distinguishable | separate messages per source | GO route → `"NCBI rate limit hit — try again in a few seconds."` (code: RATE_LIMITED); Pathway route → `"Reactome rate limit hit — try again in a few seconds."` (code: RATE_LIMITED). Distinct messages, UI maps them separately in GoAnnotationsSection vs PathwaysSection ✅ |
| 5 | Malformed JSON body | graceful degradation | `{"error": "Invalid JSON body"}` HTTP 400; no crash, no partial state ✅ |

**Additional error testing:**
- Missing required field (geneId): HTTP 400 `"geneId is required and must be a numeric string"` ✅
- Non-numeric geneId: HTTP 400 same message ✅
- Missing geneSymbol in pathways: HTTP 400 `"geneSymbol is required"` ✅

---

## Step 5 — Performance and Cache Verification

### 5.1 Rate limiter independence

Two completely separate module-level promise chains, confirmed by code inspection:

| Chain | Location | Delay | Host |
|---|---|---|---|
| `goFetchChain` | `lib/gene/go-fetch.ts:70` | `GENE_RATE_DELAY_MS` = 350ms | ncbi.nlm.nih.gov |
| `reactomeFetchChain` | `lib/gene/pathway-fetch.ts:88` | `REACTOME_RATE_DELAY_MS` = 500ms | reactome.org |

These are module-level `let` variables in separate files — no shared state. NCBI calls from other modules (transcript download, clinical evidence) use their own chains from `lib/gene/search.ts`. No cross-throttling is architecturally possible.

### 5.2 Cache reuse — repeated expand/collapse

**Observable evidence (server-side request counts):**

GO endpoint calls:
```
Call 1 (cold cache):  cached=False  ms=4633  count=208   ← NCBI EFetch called
Call 2 (same gene):   cached=True   ms=1     count=208   ← in-memory Map hit
Call 3 (same gene):   cached=True   ms=0     count=208   ← in-memory Map hit
```

Pathway endpoint calls:
```
Call 1 (cold cache):  cached=False  ms=626   count=129   ← Reactome called
Call 2 (same gene):   cached=True   ms=1     count=129   ← in-memory Map hit
```

`ms=0–1` on cache hits vs `ms=626–4633` on cold calls provides unambiguous evidence: network requests are not made after initial retrieval.

**Client-side evidence:** `BiologicalFunctionPanel.tsx` uses `goFetchedRef` and `pathwayFetchedRef` (React `useRef` booleans). Set to `true` after first successful fetch; checked at the top of `fetchGoAnnotations()` and `fetchPathways()`. Subsequent panel toggles skip the `fetch()` call entirely — zero network requests from the browser after first load.

### 5.3 Cache reuse across gene switching (TP53→BRCA1→TP53)

Sequential calls within the same server process (no restart between):

```
[1] TP53 GO (1st visit):      cached=True  ms=1    count=208  ← already in cache
[2] BRCA1 GO (navigate away): cached=True  ms=0    count=117  ← already in cache
[3] TP53 GO (return):         cached=True  ms=1    count=208  ← cache still hot
```

Both genes coexist in `goCache` Map simultaneously (keyed by `go:7157` and `go:672`). Navigating between genes does not evict the previous gene's cached data. Second TP53 view reused cached data: confirmed.

### 5.4 Volume safety

- TP53 GO: 208 annotations — retrieved in **one** NCBI EFetch XML call. No batching needed (single-gene query).
- TP53 Pathways: 129 entries — retrieved in **one** Reactome Analysis Service POST. No batching needed.
- No pagination at the network level — all data fetched in one request per gene. Client-side `GO_ASPECT_PAGE_SIZE = 20` and `PATHWAY_PAGE_SIZE = 20` control UI rendering only.

---

## Step 6 — API Compatibility Audit

### `/api/gene/go` (POST)

| Field | Pre-5.6C | Post-5.6C | Changed? |
|---|---|---|---|
| Request: geneId | string (required) | same | No |
| Request: geneSymbol | string (required) | same | No |
| Request: organism | string (required) | same | No |
| Request: taxonomyId? | string (optional) | same | No |
| Response: module | "gene-go" | same | No |
| Response: status | "success"\|"empty"\|"error" | same | No |
| Response: data | FunctionalAnnotation[] | same | No |
| Response: count, error, cached, executionTimeMs, timestamp | present | same | No |

### `/api/gene/pathways` (POST)

| Field | Pre-5.6C | Post-5.6C | Changed? |
|---|---|---|---|
| Request: all fields | same schema | same | No |
| Response: all fields | same schema | same | No |
| Data content: TP53 count | 180 (bug: included 51 mouse) | 129 (correct: human only) | **Content corrected** |

**Public APIs Changed:**

| API | Field | Old Behavior | New Behavior | Reason |
|---|---|---|---|---|
| `POST /api/gene/pathways` | `data` array length | Included ortholog pathways from all species (e.g. 180 for TP53) | Filtered to query gene's organism only (e.g. 129 for TP53/Homo sapiens) | Cross-species leakage bug fix — API schema unchanged, content correctness fix |

No field removals. No renamed fields. No semantic changes to `FunctionalAnnotation` or `PathwayMembership` interfaces.

---

## Step 7 — Targeted Regression

### Phase R resolver regression

| Query | Resolved GeneID | Organism | Confidence | Correct? |
|---|---|---|---|---|
| TP53 | 7157 | Homo sapiens | 0.92 | ✅ |
| Trp53 | 22059 | Mus musculus | 0.92 | ✅ |
| Tp53 | 24842 | Rattus norvegicus | 0.92 | ✅ |
| BRCA1 | 672 | Homo sapiens | 0.92 | ✅ |
| hepatitis | — (disease) | — | 0.72 | ✅ |
| rs28934574 | — (variant/rsID) | — | 0.97 | ✅ |

### Other explorers

- **Gene/Transcript/Protein explorers:** No files modified in these modules during Phase 5.6C
- **Variant Explorer:** `/api/variant/list` POST for BRCA1 → status=success ✅
- **Clinical Evidence:** `/api/clinical-evidence` POST → status=success ✅
- **VariantResearchContext:** Route file present and unmodified ✅
- **PubMed/GEO:** No changes in Phase 5.6 at all ✅
- **Downloads:** Transcript FASTA HTTP 200, Protein FASTA HTTP 200 ✅

### TypeScript
```
pnpm --filter @workspace/research-copilot run typecheck → tsc --noEmit (no output = zero errors)
```
Zero errors before fix, zero errors after fix. ✅

**Python changes:** None. FastAPI/Research API untouched. ✅  
**AI-generated sections:** None modified. ✅

---

## Known Limitations Across Phase 5.6

1. **Reactome-only pathways:** WikiPathways API is completely inaccessible (HTTP 404/406 from all three endpoints tested in 5.6B). Only Reactome is available. KEGG is deferred pending licensing review.

2. **Rat (Rattus norvegicus) pathway coverage:** Reactome has limited R-RNO-* pathway coverage. Tp53/rat returns an empty pathway state — this is correct behavior (empty state rather than error), not a bug.

3. **GO evidence-code-level granularity:** Same GO term with multiple evidence codes is stored as separate `FunctionalAnnotation` entries (by design, per 5.6A spec). TP53 has 208 annotation entries for ~127 unique GO terms. No deduplication was implemented — display shows all evidence variants.

4. **Cache is in-process:** The `goCache` and `pathwayCache` Maps live in the Next.js server process. They reset on server restart. In production (autoscale), each instance has its own cache. This is the same pattern as all other cached modules (variant-research-context, etc.).

5. **No pathway diagrams or hierarchy navigation:** Deferred per Phase 5.6 scope. Pathways link to Reactome PathwayBrowser permalinks.

6. **KEGG:** Deferred pending licensing review per Phase 5.6 spec.

---

## Files Added / Files Modified / Public APIs Changed

### Files Modified (Phase 5.6C only)

| File | Change |
|---|---|
| `artifacts/research-copilot/lib/gene/pathway-fetch.ts` | Added `organism` parameter to `toPathwayMemberships()`; added species filter `if (p.species.name !== organism) continue;`; updated `getGenePathways` call site to pass `organism`; added JSDoc explaining the filter |
| `PHASE-5.6C-FINAL-REPORT.md` | This report (new file) |

### Files Added (Phase 5.6C only)

- `PHASE-5.6C-FINAL-REPORT.md`

### Public APIs Changed

| API | Change | Breaking? |
|---|---|---|
| `POST /api/gene/pathways` | Data content corrected: species filter applied, ortholog pathways excluded | No — schema unchanged, correction of incorrect data |

### Breaking Changes

None.

---

## Release Summary

```
Frozen modules:
  GO Foundation (FunctionalAnnotation, parseGoAnnotations, getGeneGoAnnotations,
                 /api/gene/go, GoAnnotationsSection/AspectSection/AnnotationRow)
  Pathway Integration (PathwayMembership, getGenePathways, /api/gene/pathways,
                       PathwaysSection/PathwayRow) — with 5.6C species filter applied
  Combined Biological Function UI (BiologicalFunctionPanel.tsx)

Deferred work:
  KEGG (pending licensing review)
  Pathway diagrams and pathway hierarchy navigation
  Phase 5.7 Protein Domains

Next release: v5.7
```

**Phase 5.6 (5.6A + 5.6B + 5.6C) is now complete and frozen. Phase 5.7 can begin.**
