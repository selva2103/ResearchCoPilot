# Phase R — Biological Query Resolver Pipeline Unification — Final Report

Implements the design in
`attached_assets/Pasted-PHASE-R-BIOLOGICAL-QUERY-RESOLVER-PIPELINE-UNIFICATION-_1783512663937.txt`.
Pre-implementation state is documented in `CURRENT-STATE-NOTES.md`.
Validation evidence is in `PHASE-R-VALIDATION-LOG.md` and
`PHASE-R-REGRESSION-REPORT.md`.

**Validation status (2026-07-09):** 12/12 validation queries pass. 0 TypeScript errors.
All downstream modules (Gene Explorer, Transcript Explorer, Protein Explorer) confirmed
returning real data.

---

## 1. NormalizedQuery interface — final fields and types

Implemented exactly as specified (`types/normalized-query.ts`):

```ts
export interface CandidateResolution {
  gene: { symbol: string; geneId: string | null } | null;
  organism: { name: string; taxId: string | null } | null;
  confidence: number;
}

export interface NormalizedQuery {
  rawQuery: string;
  gene: {
    symbol: string;
    geneId: string | null;
    organismMatched: string | null;
  } | null;
  organism: {
    name: string;
    taxId: string | null;
    matchedSynonym: string | null;
  } | null;
  disease: { name: string } | null;
  protein: { accession: string } | null;
  confidence: number;
  candidates: CandidateResolution[] | null;
  ambiguous: boolean;
  evidence: {
    source: "ncbi-gene" | "medgen" | "taxonomy" | "synonym";
    matchedValue: string;
    reason: string;
  }[];
}
```

No deviation from the literal spec text.

---

## 2. Resolver — multi-entity extraction + merge (`lib/resolver/index.ts`)

Replaced the old sequential early-return pipeline (Accession → Gene →
Organism → Disease, first match wins) with:

1. **Synonym normalization** — hardcoded fallback table; unchanged from before.
2. **Accession** — pure regex, no API call. Distinct entity family; short-circuits
   into `protein.accession` (see Deviation 1 below).
3. **Explicit organism detection** — local `ORGANISM_SYNONYMS` lookup table only
   (`lib/resolver/organism-synonyms.ts`), zero API calls. Both prefix ("mouse Cd4")
   and suffix ("Trp53 Mus musculus", "BRCA2 human") patterns are generated from one
   canonical table so they cannot drift out of sync (Bug 13).
4. **Gene extraction** — `resolveGene()` called against the organism-qualified
   remainder when an explicit organism was found (Bug 2 — species-aware resolution);
   otherwise against the whole query as an uppercase-gated bare symbol, or an embedded
   gene-token within a multi-word query (Bug 1/7 — "TP53 breast cancer").
5. **Organism extraction via NCBI Taxonomy** — only when no local organism matched
   AND no gene was resolved, preserving the original call pattern and rate-limit
   profile. When a gene was resolved without an explicit organism token, the gene
   resolver's own confirmed organism/taxId is surfaced on `NormalizedQuery.organism`
   at zero extra API cost (Bug 1 — never silently discard known information).
6. **Disease extraction** — reuses the existing MedGen-based `resolveDisease()`
   unchanged. Bug 4 collision rule: a bare gene symbol with no additional context
   skips the disease call entirely (no new mandatory NCBI call). Gene + extra context
   tokens, or no gene/organism at all, calls `resolveDisease()` exactly as it always
   has.
7. **Confidence** — evidence-based (`computeConfidence()`): average of all contributing
   entity confidences plus `+0.03` per additional corroborating entity (capped at 0.99).
   Never a fixed per-query-type constant (Bug 6).
8. **Debug log** — every resolution emits one `console.log` line via `logDebug()` with
   entities detected, organism chosen, GeneID resolved, confidence, and a free-text
   reason. Required by the spec; never user-facing.

`lib/resolver/gene.ts`, `organism.ts`, `disease.ts`, `accession.ts` were **not modified** —
they remain internal entity-extraction helpers called by the new merge-stage orchestration
instead of an early-return chain.

---

## 3. Orchestrator — `app/api/analyze/route.ts`

Two new private functions added; nothing else changed:

**`buildGeneAdapterResolution(nq)`** — derives a `QueryResolution`-shaped object from
`NormalizedQuery` so Gene Explorer's existing input contract needs zero changes (see
Deviation 2 below).

**`deriveEffectiveQuery(nq, rawQuery)`** — mirrors the old HIGH-tier (≥ 0.90) auto-apply
threshold: at/above it, the resolved gene symbol (or disease name/organism name) is used
as the effective query; below it, the raw query is used unchanged.

---

## 4. Downstream module integration

**Gene Explorer (`lib/gene/index.ts`)** — input type unchanged.  The orchestrator passes a
`QueryResolution`-shaped adapter object built by `buildGeneAdapterResolution()`.  Gene
Explorer's "Case A" fast-path (`resolveByGeneId`) is triggered when the adapter carries a
`primaryIdentifier` (NCBI GeneID) at HIGH confidence, exactly as before.

**Transcript Explorer (`lib/transcript/index.ts`)** — already consumed `geneId` directly; no
raw-symbol fallback existed.  Added the **Pipeline Invariant** guard: `searchTranscripts()`
returns `{status:"empty", error:{code:"RESOLUTION_REQUIRED"}}` when called with a
missing/empty `geneId`, instead of proceeding or falling back.

**Protein Explorer (`lib/protein/index.ts`, `app/api/protein/*`)** — unchanged.  Receives
`proteinAccessionVersion` from `TranscriptRecord` on-demand from the client.  The full
chain (`NormalizedQuery.gene.geneId → GeneRecord → TranscriptRecord.proteinAccession →
ProteinRecord`) was confirmed unbroken during the validation run.

**`components/ResultsContent.tsx`** — `QueryResolutionCard` rebinds its field reads to
`NormalizedQuery`.  Confidence tier is derived via the existing `toConfidenceTier()` helper
from `types/query-resolution.ts`.  No JSX layout, class names, or styling were changed.

---

## 5. Deliberate deviations from the literal spec text

### Deviation 1 — accession queries mapped into `protein.accession`

`NormalizedQuery` has no generic "matched accession" slot; only `protein.accession` exists.
`classifyAccession()` handles any accession subtype (NM_, XM_, NP_, NC_, …), not just
proteins, so the field is repurposed as the generic slot for all accession-family queries.
This was the only reasonable mapping within the specified type.  Flagged here because the
spec's accession-chain handling is deferred (Bug 11 / Sequence Foundation), so a future
implementer should be aware of this mapping when building that chain.

### Deviation 2 — `QueryResolution`-shaped adapter bridge for Gene Explorer

The spec states Gene Explorer's input type "does NOT become NormalizedQuery; it continues
to accept the identifier shape it already accepts today."  Gene Explorer's existing shape
is `QueryResolution`.  Rather than refactoring Gene Explorer's internals,
`buildGeneAdapterResolution()` in the orchestrator synthesises a `QueryResolution`-shaped
object (populating only the fields Gene Explorer actually reads) from the new
`NormalizedQuery`.  This satisfies "Gene Explorer's input type is unchanged" literally,
at the cost of one small translation layer that must be kept in sync if Gene Explorer's
read-fields change.

### Deviation 3 — organism enrichment from gene match

When a gene is resolved without an explicit organism token in the query (e.g. bare "TP53"),
the gene resolver's own confirmed organism/taxId is surfaced on `NormalizedQuery.organism`
at no extra API cost and no confidence inflation (it is the same evidence as the gene match,
not new agreement).  Not explicitly required by the spec, but follows directly from Bug 1
("never silently discard information already known").

---

## 6. Constraints confirmed honored

- No changes to Python FastAPI, Redis, cache, rate limiter, retry logic, `ModuleResult`,
  Universal Exploration Framework, PubMed, GEO, AI-generated sections, or any module's
  UI styling / card layout / download mechanics.
- No "did you mean" disambiguation UI (Bug 5, scoped-down per spec) — `candidates` +
  `ambiguous` are populated and a default is auto-selected.
- No new external database integrations, no new rate limiter or cache system.
- No hardcoded "famous gene" or "known disease" keyword list introduced anywhere.
- The old organism-prefix-only ranking patch fully replaced by the new lookup-table system;
  not maintained in parallel.

---

## 7. Files changed from baseline (commit 70e3c71 → 8bf1945)

| File | Change |
|---|---|
| `types/normalized-query.ts` | **New** — `NormalizedQuery` + `CandidateResolution` interfaces |
| `lib/resolver/organism-synonyms.ts` | **New** — canonical organism synonym→{taxId,name} lookup table |
| `lib/resolver/organism-prefix.ts` | **Rewritten** — derives both prefix and suffix regex tables from canonical table; exports `detectOrganismPrefix()` and `detectOrganismSuffix()` |
| `lib/resolver/index.ts` | **Rewritten** — multi-entity extraction + merge, evidence-based confidence, `logDebug()` on every resolution |
| `app/api/analyze/route.ts` | **Modified** — added `buildGeneAdapterResolution()`, `deriveEffectiveQuery()`; `resolution` field type changed to `NormalizedQuery` |
| `components/ResultsContent.tsx` | **Modified** — `QueryResolutionCard` field bindings updated to `NormalizedQuery`; confidence tier derived via `toConfidenceTier()` |
| `lib/transcript/index.ts` | **Modified** — Pipeline Invariant guard added in `searchTranscripts()` |
| `CURRENT-STATE-NOTES.md` | **New** — pre-implementation snapshot (written before any code change) |
| `PHASE-R-VALIDATION-LOG.md` | **New** — resolver debug log from the live validation run |
| `PHASE-R-REGRESSION-REPORT.md` | **New** — full validation table + regression checks with actual observed values |

No files outside `artifacts/research-copilot/` were touched.
No Python, Redis, rate-limiter, or Research API files were touched.
