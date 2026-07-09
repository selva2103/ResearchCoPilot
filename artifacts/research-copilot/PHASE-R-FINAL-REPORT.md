# Phase R — Biological Query Resolver Pipeline Unification — Final Report

Implements the design in `attached_assets/Pasted-PHASE-R-BIOLOGICAL-QUERY-RESOLVER-PIPELINE-UNIFICATION-_1783512663937.txt`.
Pre-implementation state is documented in `CURRENT-STATE-NOTES.md`. Raw
per-query debug log evidence is in `PHASE-R-VALIDATION-LOG.md`.

## 1. NormalizedQuery interface — final fields and types

Implemented exactly as specified in `types/normalized-query.ts`:

```ts
interface CandidateResolution {
  gene: { symbol: string; geneId: string | null } | null;
  organism: { name: string; taxId: string | null } | null;
  confidence: number;
}

interface NormalizedQuery {
  rawQuery: string;
  gene: { symbol: string; geneId: string | null; organismMatched: string | null } | null;
  organism: { name: string; taxId: string | null; matchedSynonym: string | null } | null;
  disease: { name: string } | null;
  protein: { accession: string } | null;
  confidence: number;
  candidates: CandidateResolution[] | null;
  ambiguous: boolean;
  evidence: { source: "ncbi-gene" | "medgen" | "taxonomy" | "synonym"; matchedValue: string; reason: string }[];
}
```

No changes were needed from the literal spec text — the type was authored
directly from it.

## 2. Resolver — multi-entity extraction + merge (lib/resolver/index.ts)

Replaced the old sequential early-return pipeline (Accession → Gene →
Organism → Disease, first match wins) with:

1. **Accession** — pure regex, no API call. Distinct entity family;
   short-circuits into `protein.accession` (see Deviation 1 below).
2. **Explicit organism detection** — local lookup table only
   (`lib/resolver/organism-synonyms.ts`), zero API calls. Both prefix
   ("mouse Cd4") and new suffix ("Trp53 Mus musculus", "BRCA2 human")
   patterns are generated from one canonical table (`ORGANISM_SYNONYMS`),
   so they can never drift out of sync (Bug 13).
3. **Gene extraction** — against the organism-qualified remainder when an
   explicit organism was found (Bug 2 — species-aware resolution);
   otherwise against the whole query, or an embedded gene-shaped token in a
   multi-word query (Bug 1/7 — "TP53 breast cancer").
4. **Organism extraction** via NCBI Taxonomy — only when no local organism
   was found and no gene was resolved, preserving the original call
   pattern and rate-limit profile. When a gene *was* resolved without an
   explicit organism, the gene resolver's own organism/taxonomyId is
   surfaced onto `NormalizedQuery.organism` as free enrichment (no extra
   API call, no confidence inflation).
5. **Disease extraction** — reuses the existing MedGen-based
   `resolveDisease()` unchanged. Bug 4 collision rule: a bare gene symbol
   with no additional query context skips the disease call entirely (no
   new mandatory NCBI call, preserving rate-limit behavior). Gene + extra
   context words, or no gene/organism at all, calls `resolveDisease()`
   exactly as before.
6. **Confidence** — evidence-based (`computeConfidence()`): average of all
   contributing entity confidences plus a small per-additional-entity
   agreement bonus (`+0.03`, capped at `0.99`). Never a fixed per-query-type
   constant.

Every resolution logs one line via `logDebug()`:
`rawQuery → entities detected → organism chosen → GeneID resolved →
confidence → reason` — see `PHASE-R-VALIDATION-LOG.md` for the full log
from the validation run below.

No hardcoded gene list or disease-keyword list was introduced anywhere.

## 3. Downstream module consumption (Integrations 1–4)

- **Gene Explorer** (`lib/gene/index.ts`) — unchanged. Still accepts a
  `QueryResolution`-shaped options object; the orchestrator now builds that
  object from `NormalizedQuery` via `buildGeneAdapterResolution()` in
  `app/api/analyze/route.ts` (see Deviation 2 below).
- **Transcript Explorer** (`lib/transcript/index.ts`) — verified it already
  used `geneId` as its sole lookup key (no raw-symbol re-search existed).
  Added the **Pipeline Invariant** defensive guard: `searchTranscripts()`
  now returns a structured `status: "empty"` result with
  `error.code: "RESOLUTION_REQUIRED"` if called with an empty/missing
  `geneId`, instead of ever attempting a fallback search.
- **Protein Explorer** (`lib/protein/*`, `app/api/protein/*`) — confirmed
  unchanged; still receives `proteinAccessionVersion` from
  `TranscriptRecord` on-demand from the client, with no independent
  resolution at any step. Chain confirmed unbroken:
  `NormalizedQuery.gene.geneId → GeneRecord → TranscriptRecord.proteinAccession → ProteinRecord`.
- **`app/api/analyze/route.ts`** — the only place `NormalizedQuery` is
  consumed directly. Derives `effectiveQuery` (via `deriveEffectiveQuery()`)
  and the Gene Explorer adapter (via `buildGeneAdapterResolution()`) from
  it; never passes `NormalizedQuery` itself into a downstream module.
- **`components/ResultsContent.tsx`** — `QueryResolutionCard` rebinds its
  field reads to `NormalizedQuery` (gene/organism/disease/protein,
  `evidence[]`, `candidates[]`, `ambiguous`) with no layout/styling
  changes. The tier badge is now derived via the existing
  `toConfidenceTier()` helper instead of a resolver-supplied field.

## 4. Deliberate deviations beyond the literal spec text

1. **Accession queries → `protein.accession`.** `NormalizedQuery` has no
   generic "accession" slot — only `protein.accession`. Since accession
   classification (`classifyAccession()`) is pure regex and covers ANY
   accession subtype (transcript, genome, protein, etc.), not just
   proteins, this field is repurposed as the generic "matched accession
   identifier" slot for all of them. This was the only reasonable mapping
   available within the specified type; flagging it explicitly since the
   spec's accession handling wasn't addressed beyond "Sequence Foundation"
   (deferred, Bug 11).
2. **`QueryResolution`-shaped adapter bridge for Gene Explorer.** The spec
   states Gene Explorer's input type "does NOT become NormalizedQuery; it
   continues to accept the identifier shape it already accepts today."
   Gene Explorer's existing shape *is* `QueryResolution`. Rather than
   changing Gene Explorer's internals, `buildGeneAdapterResolution()` in
   the orchestrator synthesizes a `QueryResolution`-shaped object
   (populating only the fields Gene Explorer actually reads) from the new
   `NormalizedQuery`. This satisfies "Gene Explorer's input type is
   unchanged" literally while making `NormalizedQuery` the single
   resolver-level source of truth, at the cost of one small translation
   layer that must be kept in sync if Gene Explorer's read fields change.
3. **Organism enrichment from gene match.** Not explicitly required by the
   spec, but Bug 1 ("never silently discard information") motivated
   populating `NormalizedQuery.organism` from the gene resolver's own
   confirmed organism/taxonomyId even when no explicit organism token was
   in the query (e.g. bare "TP53" now also carries `organism: {name:
   "Homo sapiens", taxId: "9606"}`). This adds no new API call and no
   confidence inflation — it is a free derivation from data already
   fetched by the gene step.

## 5. Constraints honored

- No changes to Python FastAPI, Redis, cache, rate limiter, retry logic,
  `ModuleResult`, Universal Exploration Framework, PubMed, GEO, AI-generated
  sections, or any module's UI styling/card layout/download mechanics.
- No "did you mean" disambiguation UI built (Bug 5, scoped down as
  specified) — `candidates` + `ambiguous` are populated and a default is
  selected automatically.
- No new external database integrations, no new rate limiter/cache system.
- No hardcoded "famous gene" list anywhere.
- The old organism-prefix-only ranking patch was fully replaced by the new
  TaxID lookup-table system — not maintained in parallel.

See `PHASE-R-REGRESSION-REPORT.md` for validation and regression evidence.
