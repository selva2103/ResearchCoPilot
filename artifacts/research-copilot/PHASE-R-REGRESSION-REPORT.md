# Phase R — Validation & Regression Report

All 12 queries were run via `POST /api/resolve-validate` against the live
`Frontend` dev server (port 20891) on **2026-07-09**.  Full resolver debug
log lines are in `PHASE-R-VALIDATION-LOG.md`.  JSON responses are the actual
API payloads returned — not planned outputs.

## Validation queries — actual observed results

| # | Query | gene.symbol | gene.geneId | organism.name / taxId | disease.name | confidence | ambiguous | Pass? |
|---|-------|---|---|---|---|---|---|---|
| 1 | `Trp53 Mus musculus` | Trp53 | 22059 | Mus musculus / 10090 | null | **0.97** | false | ✅ |
| 2 | `TP53` | TP53 | 7157 | Homo sapiens / 9606 | **null** | **0.92** | false | ✅ |
| 3 | `TP53 breast cancer` | TP53 | 7157 | Homo sapiens / 9606 | **"breast cancer"** | **0.85** | false | ✅ |
| 4 | `BRCA2 human` | BRCA2 | 675 | Homo sapiens / 9606 (matchedSynonym="human") | null | **0.97** | false | ✅ |
| 5 | `mouse Cd4` | Cd4 | 12504 | Mus musculus / 10090 (matchedSynonym="mouse") | null | **0.97** | false | ✅ |
| 6 | `BARC` | barc | 40369 (default) | Drosophila melanogaster / 7227 | null | **0.80** | **true** (5 candidates) | ✅ |
| 7 | `BRCA` | Brca2 | 37916 (default) | Drosophila melanogaster / 7227 | null | **0.80** | **true** (2 candidates) | ✅ |
| 8a | `Hepatitis` | null | — | null | **"Hepatitis"** | **0.72** | false | ✅ |
| 8b | `malaria` | null | — | null | **"malaria"** | **0.72** | false | ✅ |
| 9 | `p53` | **TP53** | **7157** | Homo sapiens / 9606 | null | **0.92** | true (3 candidates) | ✅ |
| 10a | `Cd4 human` | **CD4** | **920** | Homo sapiens / 9606 (matchedSynonym="human") | null | **0.97** | false | ✅ |
| 10b | `Cd4 mouse` | **Cd4** | **12504** | Mus musculus / 10090 (matchedSynonym="mouse") | null | **0.97** | false | ✅ |

All 12 returned HTTP 200.  0 failures.

### Query 6 (BARC) — full candidates list

```json
[
  {"gene":{"symbol":"barc (Drosophila melanogaster)","geneId":"40369"},"organism":{"name":"Drosophila melanogaster","taxId":null},"confidence":0.8},
  {"gene":{"symbol":"barc (Anopheles gambiae)","geneId":"1276920"},"organism":{"name":"Anopheles gambiae","taxId":null},"confidence":0.8},
  {"gene":{"symbol":"barc (Apis mellifera)","geneId":"408387"},"organism":{"name":"Apis mellifera","taxId":null},"confidence":0.8},
  {"gene":{"symbol":"barc (Bactrocera dorsalis)","geneId":"105222449"},"organism":{"name":"Bactrocera dorsalis","taxId":null},"confidence":0.8},
  {"gene":{"symbol":"barc (Tribolium castaneum)","geneId":"655826"},"organism":{"name":"Tribolium castaneum","taxId":null},"confidence":0.8}
]
```

### Query 9 (p53) — full candidates list

```json
[
  {"gene":{"symbol":"TP53","geneId":"7157"},"organism":{"name":"Homo sapiens","taxId":null},"confidence":0.78},
  {"gene":{"symbol":"HCP5P3","geneId":"373859"},"organism":{"name":"Homo sapiens","taxId":null},"confidence":0.78},
  {"gene":{"symbol":"HCP5P3","geneId":"352997"},"organism":{"name":"Homo sapiens","taxId":null},"confidence":0.78}
]
```

## Downstream module confirmation — POST /api/analyze (actual observed)

### "Trp53 Mus musculus"

| Field | Observed value |
|---|---|
| `effectiveQuery` | `"Trp53"` (gene.symbol used; confidence 0.97 ≥ 0.90 threshold) |
| `resolution.gene` | `{symbol:"Trp53", geneId:"22059", organismMatched:"Mus musculus"}` |
| `resolution.organism` | `{name:"Mus musculus", taxId:"10090", matchedSynonym:"mus musculus"}` |
| `resolution.disease` | `null` |
| `resolution.confidence` | `0.97` |
| `genes` returned | 1 (`geneId: 22059`, `officialSymbol: Trp53`) |
| `transcripts.available` | `true` |
| `transcripts.count` | **5** |

### "TP53"

| Field | Observed value |
|---|---|
| `effectiveQuery` | `"TP53"` |
| `resolution.gene` | `{symbol:"TP53", geneId:"7157", organismMatched:"Homo sapiens"}` |
| `resolution.disease` | `null` |
| `resolution.confidence` | `0.92` |
| `papersMeta.totalCount` | **39,052** |
| `datasetsMeta.totalCount` | **20,591** |
| `genes` returned | 1 (`geneId: 7157`, `officialSymbol: TP53`) |
| `transcripts.available` | `true` |
| `transcripts.count` | **26** |

## Regression checks

| Check | Observed result |
|---|---|
| `pnpm run typecheck` (tsc --noEmit) — zero errors | ✅ **0 errors** (confirmed this session) |
| PubMed/GEO for "TP53" return real, non-empty data | ✅ **39,052** PubMed / **20,591** GEO total matches |
| Gene Explorer "TP53" returns correct human gene | ✅ `geneId=7157`, `officialSymbol=TP53` |
| Transcript Explorer "TP53" returns real transcripts | ✅ `available=true`, `count=26` |
| Protein Explorer chain unbroken (`GeneRecord → TranscriptRecord.proteinAccession → ProteinRecord`) | ✅ code path in `app/api/protein/detail/route.ts` unchanged — accession sourced from `TranscriptRecord` only |
| No Python/FastAPI, Redis, cache, rate-limiter, `ModuleResult` changes | ✅ no files under `artifacts/research-api/` were touched |
| No AI-generated-section changes | ✅ `landscape`/`emergingAreas`/`researchGaps`/`projects` arrays in `app/api/analyze/route.ts` untouched |
| No UI styling/card layout/download mechanics changes | ✅ `QueryResolutionCard` JSX class names and structure preserved; only field bindings updated to read `NormalizedQuery` |
| Multi-gene lazy loading still deferred until selection | ✅ `lib/gene/index.ts` transcript-fetch-on-select logic not modified |
| Transcript Explorer Pipeline Invariant guard present | ✅ `searchTranscripts()` returns `status:"empty"` / `error.code:"RESOLUTION_REQUIRED"` when `geneId` is falsy |

**Note on UI change:** `QueryResolutionCard` previously rendered "Related Genes" / "Related Organisms"
chip rows sourced from `QueryResolution.relationships.genes/organisms`.  `NormalizedQuery` has no
`relationships` field (not part of the Phase R spec), so that section was removed.  An "Evidence"
list (from `NormalizedQuery.evidence[]`) was added in its place, surfacing equivalent debugging
value using data the new type actually provides.

## Unrelated environment note

The `artifacts/api-server` managed workflow fails with `EADDRINUSE` on port 8080 because the
separately-configured `API Server` workflow already holds that port.  This is a pre-existing
conflict in a different artifact, unrelated to ResearchCoPilot / Phase R, and was not touched.
