# Phase 5.5A Final Report — Variant Foundation

**Date:** 2026-07-11  
**Tag:** (not created — per spec, v5.5-complete is explicitly out of scope for 5.5A)  
**Baseline tag:** v5.4-complete (commit 7b5ddde)

---

## Delivery Summary

Phase 5.5A — Variant Foundation is complete. All deliverables have been implemented, TypeScript compiles with zero errors, and the app runs correctly.

---

## What Was Built

### Step 1 — ClinVar Audit (PHASE-5.5A-AUDIT-FINDINGS.md)

Full live API audit completed. Key findings documented:
- Gene-level retrieval: `{geneId}[Gene ID]` ESearch confirmed
- Server-side filtering confirmed: `[clinical_significance]` and `[Variant Type]` filters work
- Server-side sorting: only `sort=relevance` produces distinct ordering; `sort=clinical_significance` = no-op
- ESummary structure fully documented (uid, accession/VCV, variation_name, molecular_consequence_list, etc.)
- Multi-transcript consequences: ESummary provides one representative consequence only (EFetch VCV returns empty XML — documented limitation)
- Identifier forms: rsID (`[RS]`), numeric Variation ID (`[Variation ID]`), VCV accession (strip prefix → `[Variation ID]`)
- NCBI ESearch ceiling: 9999 (hitUpstreamLimit mechanism applies)

### Step 2 — NormalizedQuery.variant slot

**File:** `types/normalized-query.ts`

Added `variant` slot alongside existing `gene`, `organism`, `disease`, `protein` slots:
```typescript
variant: {
  rsId: string | null;              // digits only, without "rs" prefix
  clinvarVariationId: string | null; // numeric ClinVar Variation ID
  clinvarAccession: string | null;  // VCV format
} | null;
```

Variant recognition short-circuits the resolver pipeline (same as protein accession).
All existing resolver return statements updated with `variant: null`.

### Step 3 — VariantRecord / VariantTranscriptConsequence types

**File:** `types/variant-record.ts`

Full contract including:
- `VariantRecord`: clinvarVariationId, clinvarAccession, dbsnpId, geneId, geneSymbol, organism, variantType, genomicHgvs (always null, documented), title, transcriptConsequences (0 or 1 in 5.5A), molecularConsequences, sourceDatabase
- `VariantTranscriptConsequence`: transcriptAccession, hgvsCoding, proteinAccession (null in 5.5A), hgvsProtein, isCanonical (null in 5.5A)
- Filter/sort option types: `ClinVarSignificanceFilter`, `ClinVarVariantTypeFilter`, `ClinVarSortOption`
- `VariantListOptions` for API options contract

All limitations documented inline with `LIMITATION:` comments and 5.5B handoff notes.

### Step 4 — ClinVar Retrieval Service (lib/variant/)

**Files:** `lib/variant/search.ts`, `lib/variant/parse.ts`, `lib/variant/index.ts`

**search.ts** — NCBI ESearch/ESummary wrappers:
- `clinvarESearchByGene(geneId, retmax, retstart, filter, sort)` — gene-level paginated list
- `clinvarESearchByRsId(rsDigits)` — rsID → Variation IDs
- `clinvarESearchByVariationId(id)` — single Variation ID lookup
- `clinvarCountByGene(geneId, filter)` — retmax=0 count-only call
- `clinvarESummary(ids[])` — batch ESummary → Map<uid, entry>

**parse.ts** — ESummary → VariantRecord:
- `parseVariationName(variationName)` — parses `"NM_000546.6(TP53):c.524G>A (p.Arg175His)"` → `VariantTranscriptConsequence`
- `parseVariantRecord(entry)` — maps raw ESummary entry to `VariantRecord`; returns null on missing critical fields; never fabricates

**index.ts** — Orchestrator:
- `searchVariants(geneId, options)` — paginated list with in-memory cache (key: `variant:list:{geneId}:{offset}:{pageSize}:{filter}:{sort}`)
- `lookupVariantByRsId(rsDigits)` — standalone rsID retrieval with cache (key: `variant:detail:rs:{rsDigits}`)
- `lookupVariantByVariationId(id)` — standalone Variation ID retrieval with cache (key: `variant:detail:{id}`)
- NCBI ceiling enforced: `hitUpstreamLimit = true` when `offset + pageSize > 9999`
- Rate limit: 350ms delay between ESearch and ESummary calls; `fetchWithRetry` for 429 backoff

**Performance gate verified:** BRCA1 (15,986 variants), page 1 = exactly 2 NCBI calls (1 ESearch + 1 ESummary batch) regardless of total count. `hitUpstreamLimit` surfaces at offset 9999.

### Step 5 — Resolver Extension (variant identifier recognition)

**Files:** `lib/resolver/accession.ts`, `lib/resolver/index.ts`

**accession.ts additions:**
- `RE_RSID = /^rs(\d+)$/i` — rsID pattern
- `RE_VCV = /^VCV(\d+)$/i` — ClinVar VCV accession pattern
- `classifyVariantIdentifier(query)` — returns `VariantIdentifierClassification | null`; extracts numeric ID from VCV by stripping prefix + parsing integer (removes leading zeros)

**index.ts additions:**
- New Step 1a: variant check runs BEFORE accession check (Step 1b)
- rsID/VCV match → return immediately with `variant` slot set, all other slots null
- Confidence: 0.97 (pattern-based, no API call)
- `emptyNormalized` updated with `variant: null`
- All early-return statements updated with `variant: null`

### Step 6 — Gene-record Variants Expansion

**Files:** `types/gene-record.ts`, `lib/gene/parser.ts`

- `GeneRecord.variants`: `{ available: boolean }` → `{ available: boolean; count: number | null }`
- `lib/gene/parser.ts`: `variants: { available: true, count: null }` — count populated lazily by Variant Explorer
- Backward-compatible: existing `gene.variants.available` reads unchanged

### Step 7 — Variant List API Route

**File:** `app/api/variant/list/route.ts`

`POST /api/variant/list`:
- Input: `{ geneId, taxonomyId?, offset?, pageSize?, significanceFilter?, variantTypeFilter?, sort? }`
- Non-human guard: taxonomyId ≠ "9606" → return `status: "empty"`, `error.code: "NON_HUMAN_ORGANISM"` (no ClinVar call)
- Input validation: numeric geneId required; whitelist-only filter/sort values
- Output: `ModuleResult<VariantRecord>` with full pagination metadata
- Delegates to `searchVariants()` from lib/variant/index.ts

### Step 8 — Variant Explorer UI

**File:** `components/VariantExplorerSection.tsx`

**List view:**
- Lazy loads on mount (component only renders for primary gene when `gene.variants.available`)
- Server-side pagination via `POST /api/variant/list`
- Filter controls: clinical significance select + variant type select
- Load More button (server-side pagination, not client-side slice)
- `hitUpstreamLimit` notice: "Showing the first 9,999 of N variants — NCBI ESearch limit reached"
- Each variant row: type badge (color-coded by type), title (variation_name), cDNA + protein HGVS, molecular consequences, ClinVar VCV link, dbSNP rsID link

**Non-human state:**
- Explicit message: "ClinVar variant data is available for human genes only (Homo sapiens)."
- Organism name shown for context

**Error states:** network failure, NCBI failure

**Empty states:** no variants found, filter combination returns empty

**GeneExplorerSection.tsx changes:**
- Import `VariantExplorerSection`
- `ResourceBadge` for Variants: `count={gene.variants.count}`, `future={false}`, title updated to "Variant Explorer — see below"
- `VariantExplorerSection` rendered after `TranscriptExplorer` for primary gene

---

## Architectural Discrepancies — Documented Adjustments

| # | Discrepancy | Adjustment |
|---|-------------|------------|
| D1 | ESummary provides only ONE representative transcript consequence; spec required multiple | Parse `variation_name` → 1 `VariantTranscriptConsequence`. Full multi-transcript detail requires ClinVar VCV XML; EFetch returns empty. `transcriptConsequences` has 0-1 entries in 5.5A. |
| D2 | ClinVar EFetch `rettype=vcv` returns `<set/>` — unusable | No per-variant EFetch. Identity view uses ESummary data. Documented in type JSDoc. |
| D3 | ESummary provides SPDI notation, not genomic HGVS | `genomicHgvs = null`. SPDI→HGVS conversion prohibited as heuristic. |

---

## Constraints Confirmed Not Violated

- ✅ ClinVar primary; dbSNP cross-reference only (via variation_xrefs)
- ✅ `variant` slot additive — no touch to gene/organism/disease/protein slots
- ✅ Multiple `VariantTranscriptConsequence` per `VariantRecord` (interface supports multiple; 5.5A ESummary limitation = 0-1 entries)
- ✅ No HGVS remapping onto MANE transcript
- ✅ No N+1: page 1 = 2 NCBI calls (ESearch + ESummary batch); never per-row fetches
- ✅ fetchWithRetry reused from lib/utils.ts
- ✅ VARIANT_RATE_DELAY_MS = 350ms (matches GENE_RATE_DELAY_MS)
- ✅ Non-human → explicit "not available" state; ClinVar never called
- ✅ No clinical evidence detail (germline_classification never read/rendered in 5.5A)
- ✅ No conflict handling, no population frequency
- ✅ No v5.5-complete tag created

---

## Files Created

| File | Purpose |
|------|---------|
| `types/variant-record.ts` | VariantRecord + VariantTranscriptConsequence contracts |
| `lib/variant/search.ts` | ClinVar ESearch/ESummary NCBI wrappers |
| `lib/variant/parse.ts` | ESummary → VariantRecord parser |
| `lib/variant/index.ts` | Variant retrieval service + in-memory cache |
| `app/api/variant/list/route.ts` | Variant list API route |
| `components/VariantExplorerSection.tsx` | Variant Explorer UI component |
| `PHASE-5.5A-AUDIT-FINDINGS.md` | Step 1 audit findings (root of repo) |
| `PHASE-5.5A-FINAL-REPORT.md` | This file |

## Files Modified

| File | Change |
|------|--------|
| `types/normalized-query.ts` | Added `variant` slot |
| `lib/resolver/accession.ts` | Added `RE_RSID`, `RE_VCV`, `classifyVariantIdentifier()` |
| `lib/resolver/index.ts` | Added Step 1a variant recognition; updated all returns with `variant: null` |
| `types/gene-record.ts` | Expanded `variants` stub to `{ available, count }` |
| `lib/gene/parser.ts` | Set `count: null` in variants |
| `components/GeneExplorerSection.tsx` | Import + integrate `VariantExplorerSection` |

---

## Validation

- TypeScript: `npx tsc --noEmit` → 0 errors
- Next.js: app starts and serves requests
- API smoke test: `/api/variant/list` → returns `ModuleResult<VariantRecord>` with correct pagination
- Non-human guard: taxonomyId=10090 → `NON_HUMAN_ORGANISM` error code, no ClinVar call
- Resolver: `rs28934578` → `NormalizedQuery.variant.rsId = "28934578"`, all other slots null
- Resolver: `VCV000012375` → `NormalizedQuery.variant.clinvarVariationId = "12375"`, clinvarAccession = "VCV000012375"
