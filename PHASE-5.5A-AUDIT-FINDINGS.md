# Phase 5.5A Audit Findings

**Date:** 2026-07-11  
**Purpose:** Pre-implementation audit required by Phase 5.5A spec — Step 1. Do not modify.

---

## 1. Repository Structure Findings

### 1.1 NormalizedQuery (types/normalized-query.ts)

Current shape (65 lines):
```typescript
export interface NormalizedQuery {
  rawQuery: string;
  gene: { symbol: string; geneId: string | null; organismMatched: string | null; } | null;
  organism: { name: string; taxId: string | null; matchedSynonym: string | null; } | null;
  disease: { name: string; } | null;
  protein: { accession: string; } | null;
  confidence: number;
  candidates: CandidateResolution[] | null;
  ambiguous: boolean;
  evidence: { source: "ncbi-gene" | "medgen" | "taxonomy" | "synonym"; matchedValue: string; reason: string; }[];
}
```

**Variant slot placement:** A `variant` slot is added alongside the existing entity slots. When a rsID or VCV accession is recognized, `variant` is set and all other entity slots are null (analogous to the protein accession short-circuit path). The resolver returns early with `variant` set.

### 1.2 Resolver (lib/resolver/index.ts)

Pipeline (414 lines):
1. Synonym normalization
2. Accession classification (`classifyAccession` in lib/resolver/accession.ts) — pure regex, no API call. Returns early with `protein.accession` set.
3. Explicit organism detection (local lookup table)
4. Gene extraction
5. Organism extraction (NCBI Taxonomy ESearch)
6. Disease extraction (MedGen)
7. Confidence + log

**Variant insertion point:** After synonym normalization (Step 1), before accession classification (Step 2). A new variant regex check runs first. If matched, return immediately with `variant` set. This preserves all existing behavior since the variant patterns do not overlap with existing accession patterns.

Alternative: Extend `classifyAccession` to detect rsID/VCV patterns and set `variant` instead of `protein.accession`. This is cleaner since accession.ts already handles all prefix-pattern classification. **Chosen approach:** Extend classifyAccession to return a `variant` classification; resolver index checks for that classification and sets `NormalizedQuery.variant`.

### 1.3 Existing NCBI Infrastructure

- **fetchWithRetry** (`lib/utils.ts`): Retry on HTTP 429 with 1500ms delay, max 2 retries. Reused for ClinVar.
- **GENE_RATE_DELAY_MS** (`lib/gene/search.ts`): 350ms delay between NCBI calls. Imported and reused.
- **sleep** (`lib/gene/search.ts`): Promise-based sleep. Imported and reused.
- **NCBI_BASE**: `"https://eutils.ncbi.nlm.nih.gov/entrez/eutils"` — defined in lib/gene/search.ts, redefined locally in each module. Pattern: each module defines its own constant.

### 1.4 Cache Architecture

- **No Redis**: All caches are in-memory `Map` objects, per-module, per-request or module-level singletons.
- Existing namespaces: `protein:summary:*`, `protein:detail:*`, `protein:fasta:*` (5.4A), `researchcontext:protein:*` (5.4B).
- **New namespaces**: `variant:list:{geneId}:{page}:{pageSize}:{filter}:{sort}` and `variant:detail:{clinvarVariationId}` — must not overlap with existing namespaces. These are module-level Maps keyed by the namespace string.

### 1.5 Universal Pagination Framework (types/module-result.ts)

- `ModuleResult<T>` with optional pagination fields: `totalCount`, `pageSize`, `offset`, `hasMore`, `nextOffset`, `currentPage`, `totalPages`, `hitUpstreamLimit`.
- `ExploreOptions`: `{ limit?: number; offset?: number; }` — mapped to NCBI `retmax`/`retstart`.
- `buildModuleResult` helper: computes `count`, `executionTimeMs`, `timestamp` automatically.
- **NCBI ceiling**: `retstart + retmax ≤ 9999`. When `offset + pageSize > 9999`, `hitUpstreamLimit = true`.
- **Default page size**: 10 (matches PubMed/GEO convention). Max safe: 100 per ESummary batch.

### 1.6 Gene → Transcript → Protein Chain

- GeneRecord exposes: `geneId` (string), `officialSymbol`, `organism`, `taxonomyId`.
- `variants: { available: boolean }` stub at GeneRecord (Phase 5.2, types/gene-record.ts:214).
- Analyze route (analyze/route.ts): after gene retrieval, calls transcript search for primary gene, mutates `genes[0].transcripts`. Same attachment point for variant count.
- **Variant attachment:** Expand `GeneRecord.variants` to `{ available: boolean; count: number | null }`. Set `count: null` in initial gene record (fetched lazily by the variant list UI). The `count` is returned in `ModuleResult.totalCount` by the variant list API.

### 1.7 Resource Stub Integration (GeneExplorerSection.tsx:341–345)

```tsx
label="Variants"
available={gene.variants.available}
title="Phase 5.5 — Variant Annotation"
```
The `VariantExplorerSection` will be integrated in the same pattern as `ProteinExplorerSection` — rendered inside the gene card, lazy-loaded on user interaction.

---

## 2. ClinVar / NCBI Live Capability Audit

### 2.1 Gene-level Retrieval

**Query pattern:** `POST https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term={geneId}[Gene ID]&retmax={n}&retmode=json`

**Evidence:**
- TP53 (geneId=7157): count=3991 ✅
- BRCA1 (geneId=672): count=15986 ✅

**Stable identifier:** ESummary `uid` (numeric string) = ClinVar Variation ID. Carries between ESearch (idlist) and ESummary/detail retrieval. `accession` = VCV format (e.g., VCV004856711).

**Total count:** `esearchresult.count` (string) returned at retmax=0. Safe to fetch count separately in a single retmax=0 call.

### 2.2 Server-side Sorting

**Tested parameters:**
- `sort=clinical_significance`: Returns SAME IDs as default order. **NOT supported** as a distinct sort.
- `sort=acc`: Returns SAME IDs as default order. Not distinct.
- `sort=relevance`: Returns DIFFERENT IDs (evidence: [4852755, 4852731, 4822393] vs default [4856711, 4855662, 4852755]). Different ordering confirmed.

**Finding:** Server-side sorting by clinical significance or review status is **NOT supported** by ClinVar/NCBI ESearch. Only `sort=relevance` produces a distinct ordering from default.

**Constraint enforced:** The UI will NOT display "sorted by clinical significance." Default sort = NCBI default (most recent by Variation ID descending based on observed behavior). Optional `sort=relevance` will be supported but not labeled as "clinical significance first."

### 2.3 Server-side Filtering

**Tested and confirmed:**
- `"pathogenic"[clinical_significance]`: TP53 → 1736 results ✅
- `"single nucleotide variant"[Variant Type]`: TP53 → 2754 results ✅
- Both are volume-safe (fetch page, not all results). These are the only supported filters in Phase 5.5A.

**Filter values for clinical significance:** `"pathogenic"`, `"likely pathogenic"`, `"benign"`, `"likely benign"`, `"uncertain significance"` — standard ClinVar vocabulary.
**Filter values for variant type:** `"single nucleotide variant"`, `"deletion"`, `"insertion"`, `"indel"`, `"duplication"` — from observed `obj_type` field.

### 2.4 Summary vs. Detail Boundary

**ESummary fields confirmed available per variant:**
- `uid` → numeric ClinVar Variation ID
- `accession` → VCV accession (e.g., VCV004856711)
- `accession_version` → VCV with version (e.g., VCV004856711.1)
- `obj_type` → variant type string (e.g., "single nucleotide variant", "Indel")
- `variation_set[0].variation_name` → representative HGVS string
- `variation_set[0].cdna_change` → coding change only (no transcript prefix)
- `variation_set[0].canonical_spdi` → SPDI notation for genomic location
- `variation_set[0].variation_xrefs` → array including dbSNP cross-refs
- `molecular_consequence_list` → array of consequence type strings
- `protein_change` → comma-separated protein-level changes (multiple transcripts, no accessions)
- `genes` → array with `symbol` and `geneid`
- `germline_classification.description` → clinical significance string (5.5B scope)
- `germline_classification.review_status` → review status (5.5B scope)
- `supporting_submissions.rcv` / `.scv` → RCV/SCV accession arrays (5.5B scope)

**Confirmed NOT fetched:** Individual submission data (SCV content), RCV condition assertions. These are 5.5B scope only.

### 2.5 Multi-Transcript Consequences — Architectural Discrepancy

**Finding:** ClinVar ESummary provides **ONE** representative transcript consequence per variant, encoded as:
- `variation_set[0].variation_name`: e.g., `"NM_000546.6(TP53):c.524G>A (p.Arg175His)"` → single transcript
- `protein_change`: comma-separated changes without transcript accessions, e.g., `"R175H, R136H, R43H, R16H"` → multiple transcripts implied but accessions not provided

**ClinVar EFetch for VCV XML:** `rettype=vcv` returns empty `<ClinVarResult-Set><set/></ClinVarResult-Set>` for all tested variants. Deprecated variation blobs return error. **EFetch cannot be used to retrieve transcript consequence details per variant via EUtils.**

**Architectural Discrepancy D1 (implementation-detail level):** The spec requires `transcriptConsequences: readonly VariantTranscriptConsequence[]` with potentially multiple entries. ESummary provides only one representative consequence.

**Smallest adjustment:** Parse `variation_set[0].variation_name` into ONE VariantTranscriptConsequence. The `isCanonical` field is null (cannot be determined from ESummary alone — the transcript in variation_name is NM_000546.6 which IS MANE Select for TP53, but this cannot be determined from ESummary without a separate cross-reference). `proteinAccession` = null (not present in variation_name; inferring it from the existing protein chain is prohibited). `transcriptConsequences` will have 0 entries when `variation_name` cannot be parsed, or 1 entry when parsed successfully. This is documented limitation, not a redesign.

### 2.6 Identifier Forms — Confirmed Support

| Form | ESearch term | Example | Evidence |
|------|-------------|---------|---------|
| rsID (dbSNP) | `{digits}[RS]` | `rs28934578` → [182963, 12374] | ✅ Confirmed |
| ClinVar Variation ID (numeric) | `{id}[Variation ID]` | `12375` → [12375] | ✅ Confirmed |
| VCV accession | Strip `VCV` prefix, use `[Variation ID]` | `VCV000012375` → strip → `12375` | ✅ Confirmed (VCV[Accession] lookup fails; numeric works) |

**Not supported as standalone lookup:** Raw numeric IDs (cannot safely distinguish from GeneIDs, PubMed IDs, etc.). RCV/SCV accessions (5.5B scope).

**Identifier normalization in resolver:**
- `rs\d+` pattern (case-insensitive) → resolved as rsID
- `VCV\d+` pattern (case-insensitive) → resolved as VCV accession, numeric ID extracted
- Both are pure regex, no API call at resolver stage

---

## 3. Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Parse single consequence from `variation_name` | ESummary limitation; no multi-transcript data available via EUtils. Documented. |
| `sort=relevance` only (no clinical significance sort) | Not supported by NCBI. UI will not claim significance-ordered display. |
| Filter on `clinical_significance` and `Variant Type` | Confirmed volume-safe server-side support. |
| In-memory Map caches only | Consistent with all existing modules. |
| pageSize default 20, max 100 | Variant records are heavier than paper titles but lighter than full GeneRecords. |
| NCBI ceiling enforcement at offset+pageSize > 9999 | Standard across all modules. |
| Non-human variants: explicit unsupported-data state | ClinVar is human-centric; non-human organism queries gate off the variant module. |

---

## 4. Files Modified / Created by Phase 5.5A

**New files:**
- `types/variant-record.ts`
- `lib/variant/search.ts`
- `lib/variant/parse.ts`
- `lib/variant/index.ts`
- `app/api/variant/list/route.ts`
- `components/VariantExplorerSection.tsx`
- `PHASE-5.5A-AUDIT-FINDINGS.md` (this file)
- `PHASE-5.5A-FINAL-REPORT.md`

**Modified files:**
- `types/normalized-query.ts` — add `variant` slot
- `lib/resolver/accession.ts` — add rsID + VCV regex patterns
- `lib/resolver/index.ts` — add variant slot recognition and return
- `types/gene-record.ts` — expand `variants` stub to include `count: number | null`
- `lib/gene/parser.ts` — set `count: null` in variants (was not present before)
- `components/GeneExplorerSection.tsx` — integrate VariantExplorerSection

**Not modified:** lib/gene/index.ts, lib/gene/links.ts, lib/gene/fetch.ts, lib/transcript/*, lib/protein/*, lib/pubmed/*, lib/geo/*, lib/genbank/*, app/api/analyze/route.ts (no modification needed — variants are loaded lazily via dedicated route, not analyze route).
