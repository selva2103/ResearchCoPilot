# CURRENT-STATE-NOTES.md — Phase R pre-implementation snapshot

Written before any Phase R code changes, per the spec's FIRST ACTION requirement.

## 1. What the resolver outputs today

`resolveQuery(query): Promise<QueryResolution>` (`lib/resolver/index.ts`) runs a
**sequential early-return** pipeline:

1. Organism-prefix pre-step (local regex, e.g. "mouse CD4") → if a gene is found for
   that organism, return immediately.
2. Synonym normalization (hardcoded table).
3. Accession classification (pure regex, e.g. `NM_000546`) → return immediately if matched.
4. Gene (NCBI Gene ESearch, only if the **whole trimmed query** matches a gene-symbol
   shape) → return immediately if confidence ≥ 0.60.
5. Organism (NCBI Taxonomy ESearch) → return immediately if confidence ≥ 0.60.
6. Disease (NCBI MedGen ESearch), gated by a **hardcoded regex** `DISEASE_QUALIFIER_RE`
   (words like "mutation", "syndrome", "cancer") that blocks disease resolution for
   bare gene-symbol-shaped queries → return if confidence ≥ 0.60.
7. Otherwise Unknown.

**Consequence:** only one entity type is ever returned. A multi-word query like
`"TP53 breast cancer"` never even attempts gene resolution (it isn't gene-symbol-shaped
as a whole string with spaces), so it resolves as Disease-only — the gene is silently lost.
Organism detection today only handles the *prefix* pattern ("mouse CD4"), never suffix
("Trp53 Mus musculus", "BRCA2 human").

## 2. What each downstream module accepts today

- **Gene Explorer** (`lib/gene/index.ts`, `searchGeneExplorer(query, options)`) — accepts
  the raw query string plus `options.resolution: QueryResolution | null`. When
  `resolution.queryType === "Gene"` at `confidenceTier === "high"` with a
  `primaryIdentifier`, it skips ESearch entirely and fetches directly by Gene ID
  ("Case A", `resolveByGeneId`). Otherwise it falls back to ESearch by symbol or free text.
  It also gates itself off entirely when the resolver identified a non-gene type
  (Organism/Disease/Accession/etc.) at HIGH confidence.
- **Transcript Explorer** (`lib/transcript/index.ts`, `searchTranscripts(geneId, geneSymbol,
  organism, taxonomyId, options)`) — **already** takes a resolved `geneId` as a direct
  argument, never a raw query string. It is only ever invoked from the orchestrator with
  `primary.geneId` taken from the `GeneRecord` that Gene Explorer already resolved. There is
  no raw-symbol fallback path in this module today.
- **Protein Explorer** (`lib/protein/index.ts`, `app/api/protein/*`) — takes
  `proteinAccessionVersion` / a `TranscriptRecord`, never a raw query. It runs on-demand
  from the frontend, decoupled from `/api/analyze`.

**Conclusion confirming the spec's own "SCOPE REFOCUS" note:** the originally-suspected
root cause (Transcript Explorer re-searching by raw symbol) does not exist in the current
code. The real defect is entirely in the resolver: it returns the wrong entity type for
multi-entity queries, has no suffix-organism detection, uses a hardcoded disease-keyword
gate, and has no evidence-based confidence scoring.

## 3. Files touched in this phase

- `types/normalized-query.ts` (new)
- `lib/resolver/organism-synonyms.ts` (new — canonical Bug 13 lookup table)
- `lib/resolver/organism-prefix.ts` (refactored to source from the canonical table; added suffix detection)
- `lib/resolver/index.ts` (rewritten: multi-entity extraction + merge, evidence-based confidence, debug log)
- `app/api/analyze/route.ts` (derives per-module identifiers from `NormalizedQuery`)
- `app/api/resolve-validate/route.ts` (unchanged code — now returns `NormalizedQuery` since it passes through `resolveQuery()`'s result)
- `components/ResultsContent.tsx` (data-binding only, no layout/styling change — reads the new `NormalizedQuery` shape instead of `QueryResolution`)
- `lib/transcript/index.ts` (defensive Pipeline Invariant guard added; no rewrite of fetch logic)

`lib/resolver/gene.ts`, `organism.ts`, `disease.ts`, `accession.ts` are **not modified** —
they continue to be used as internal entity-extraction helpers, called by the new
merge-stage orchestration in `index.ts` instead of an early-return chain.
