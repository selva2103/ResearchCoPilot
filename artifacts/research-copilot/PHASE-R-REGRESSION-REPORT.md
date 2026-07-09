# Phase R — Validation & Regression Report

All 12 queries below were run via `POST /api/resolve-validate` against the
running `Frontend` dev server (port 20891). Full raw debug-log lines are in
`PHASE-R-VALIDATION-LOG.md`.

## Validation queries

| # | Query | gene.symbol | gene.geneId | organism.name / taxId | disease.name | confidence | Result |
|---|-------|---|---|---|---|---|---|
| 1 | "Trp53 Mus musculus" | Trp53 | 22059 | Mus musculus / 10090 | null | 0.97 | ✅ ≥0.9; Gene/Transcript Explorer confirmed returning real data (see below) |
| 2 | "TP53" | TP53 | 7157 | Homo sapiens / 9606 | **null** | 0.92 | ✅ gene preferred over disease, disease=null, confidence high |
| 3 | "TP53 breast cancer" | TP53 | 7157 | Homo sapiens / 9606 | **"breast cancer"** | 0.85 | ✅ both gene AND disease populated |
| 4 | "BRCA2 human" | BRCA2 | 675 | Homo sapiens / 9606 | null | 0.97 | ✅ rawQuery = "BRCA2 human" unmodified |
| 5 | "mouse Cd4" | Cd4 | 12504 | Mus musculus / 10090, matchedSynonym="mouse" | null | 0.97 | ✅ synonym→taxId resolved correctly |
| 6 | "BARC" | barc | 40369 (default pick) | Drosophila melanogaster / 7227 | null | 0.80 | ✅ `candidates` has 5 entries, `ambiguous: true`, a default still selected |
| 7 | "BRCA" | Brca2 | 37916 (default pick) | Drosophila melanogaster / 7227 | null | 0.80 | ✅ `candidates` populated, `ambiguous: true`; Gene Explorer's existing lazy-loading (unchanged) still fetches transcripts/proteins for the selected gene only |
| 8a | "Hepatitis" | null | — | null | "Hepatitis" | 0.72 | ✅ non-colliding disease query unaffected by Bug 4 rule |
| 8b | "malaria" | null | — | null | "malaria" | 0.72 | ✅ same |
| 9 | "p53" | **TP53** | **7157** | Homo sapiens / 9606 | null | 0.92 | ✅ synonym (not official symbol) resolved correctly, matches GeneID 7157 |
| 10a | "Cd4 human" | CD4 | **920** | Homo sapiens / 9606 | null | 0.97 | ✅ species-specific GeneID |
| 10b | "Cd4 mouse" | Cd4 | **12504** | Mus musculus / 10090 | null | 0.97 | ✅ different GeneID than 10a, proving species-aware resolution (Bugs 2/3) |

## Downstream module confirmation (non-empty-state check)

For query 1 ("Trp53 Mus musculus") via `POST /api/analyze`:
- `effectiveQuery`: `"Trp53"` (derived from `gene.symbol`, confidence ≥ 0.90)
- Gene Explorer: 1 gene returned, `geneId=22059`, `officialSymbol=Trp53`
- Transcript Explorer: `transcripts.available=true`, `count=5` (real transcripts, not "No transcript")

For query "TP53" via `POST /api/analyze`:
- `effectiveQuery`: `"TP53"`
- PubMed: 3 papers returned this page, `papersMeta.totalCount=39043`
- GEO: 3 datasets returned this page, `datasetsMeta.totalCount=20589`
- Gene Explorer: `geneId=7157`, `officialSymbol=TP53`
- Transcript Explorer: `transcripts.available=true`, `count=26`

Protein Explorer is unchanged (on-demand, client-triggered from a
`TranscriptRecord.proteinAccessionVersion`) — confirmed the code path
(`app/api/protein/detail/route.ts`) still receives its accession from the
transcript record only, with no independent resolution step.

## Regression checks

| Check | Result |
|---|---|
| PubMed/GEO results for "TP53" return real, non-empty data | ✅ 39,043 / 20,589 total matches |
| Gene Explorer "TP53" returns the correct human gene (7157) | ✅ |
| Transcript Explorer "TP53" returns real transcripts (26) | ✅ |
| Protein Explorer chain (`GeneRecord → TranscriptRecord.proteinAccession → ProteinRecord`) unbroken | ✅ (code path unchanged, verified by inspection) |
| `pnpm run typecheck` (tsc --noEmit) — zero errors | ✅ (verified after every step: types file, organism tables, resolver rewrite, orchestrator, ResultsContent, transcript guard) |
| No Python/FastAPI, Redis, cache, rate-limiter, retry-logic, or `ModuleResult` changes | ✅ — no files under `artifacts/research-api` or any Python file were touched |
| No AI-generated-section changes | ✅ — `landscape`/`emergingAreas`/`researchGaps`/`projects` mock arrays in `app/api/analyze/route.ts` untouched |
| No UI styling/card layout/download mechanics changes | ✅ — `QueryResolutionCard` JSX structure/classNames preserved; only field bindings changed (old relationships-genes/organisms chip section removed since `NormalizedQuery` has no `relationships` field — see note below) |
| Multi-gene lazy loading (Bug 12) still deferred until selection | ✅ — unchanged; Gene Explorer/transcript-fetch-on-select logic in `lib/gene` was not modified |

**Note on UI removal:** `QueryResolutionCard` previously rendered "Related
Genes" / "Related Organisms" chip rows sourced from
`QueryResolution.relationships.genes/organisms` (populated only for
disease queries with known disease→organism associations, e.g.
"Tuberculosis" → *Mycobacterium tuberculosis*). `NormalizedQuery` has no
`relationships` field (not specified in Phase R), so this section was
removed as dead code rather than left unreachable. An "Evidence" list
(from `NormalizedQuery.evidence[]`) was added in its place, which
surfaces comparable debugging value using data the new type actually
provides.

## Unrelated environment note

The `artifacts/api-server` workflow shows a pre-existing `EADDRINUSE`
failure (port 8080 conflict with the separately-configured `API Server`
workflow, which is running and healthy). This is a different artifact,
unrelated to ResearchCoPilot / Phase R, and was left untouched — it was
already present before this session's changes and is out of scope for the
Phase R spec.
