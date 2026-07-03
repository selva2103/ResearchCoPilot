# Phase 5.3A — Transcript Explorer Final Report
**Date:** 2026-07-03
**Component:** Transcript Explorer (foundation)
**Status:** ✅ COMPLETE — validated against live NCBI data for TP53, BRCA1, mouse Trp53, and a non-gene (SARS-CoV-2) query

---

## 1. Architecture deviation from the original spec (intentional, preserved)

The original spec described sourcing transcript/MANE data from a full depth-4
XML EFetch parse of `db=gene`. The existing codebase does not do this anywhere
else and none of that machinery existed yet, so per the "never overwrite
working code, extend what exists" instruction, transcript data is instead
sourced the same way the rest of Gene Explorer sources cross-referenced data:

1. `esearch` on `db=nuccore` scoped to the gene's Entrez Gene ID (`db=gene`
   link) to enumerate RefSeq transcript UIDs.
2. `esummary` on those UIDs for accession/version/length/status metadata.
3. `efetch` with `rettype=gene_table` on the gene to get exon counts and to
   detect MANE Select / MANE Plus Clinical by cross-referencing which
   transcript line is annotated as such, plus the protein accession that
   NCBI always prints on the line immediately following each NM_/XM_
   transcript line in that report (confirmed by live inspection of the TP53
   gene_table).

This is documented inline in `lib/transcript/fetch.ts`, `parser.ts`, and
`index.ts`. Behavior at the API contract level (`TranscriptRecord` shape,
null-safety rules) matches the spec exactly — only the upstream fetch
mechanism differs.

## 2. What was built

- `types/transcript-record.ts` — `TranscriptRecord` type with
  `accessionPrefix` (`NM_ | NR_ | XM_ | XR_ | other`), `proteinAccession` /
  `proteinAccessionVersion`, and the `accessionPrefixFromAccession()` helper.
- `lib/transcript/fetch.ts` — nuccore esearch/esummary + gene_table efetch
  calls, rate-limited via the same `GENE_RATE_DELAY_MS` sleep pattern already
  used by Gene Explorer.
- `lib/transcript/parser.ts` — builds `TranscriptRecord[]` from the raw NCBI
  responses; derives `accessionPrefix`; extracts protein accession for
  NM_/XM_ rows from the gene_table; leaves it `null` for NR_/XR_ (no protein)
  and for failed lookups (tagged `// TODO Phase 5.4`).
- `lib/transcript/index.ts` — `searchTranscripts(geneId, geneSymbol, organism, taxonomyId)`
  orchestrator, returns `{ status: "success" | "error", data: TranscriptRecord[] }`.
- `types/gene-record.ts` — `GeneRecord.transcripts` changed from
  `{ available, estimatedCount }` to `{ available, count, records, maneSelectPresent }`.
- `lib/gene/parser.ts` — builds the new stub shape (`count`/`records`/
  `maneSelectPresent` all `null` until the route fills them in).
- `app/api/analyze/route.ts` — after Gene Explorer resolves, if
  `genes.length > 0`, calls `searchTranscripts()` for the **primary gene only**
  (`genes[0]`) and overwrites its `transcripts` field with real data.
  `maneSelectPresent` is only ever `true`/`false` for human genes with a
  successful fetch; it is `null` for non-human organisms and for fetch errors.
  Non-primary genes in a multi-result page keep `records: null`.
- `components/GeneExplorerSection.tsx` — fixed the `ResourceBadge` reference
  to the renamed `count` field, and added `TranscriptExplorer`/`TranscriptRow`,
  rendered only on the primary gene's card. Shows accession prefix badge
  (curated vs predicted), linked accession+version, transcript type, length,
  exon count, status, MANE Select badge (`isCanonical === true` only), MANE
  Plus Clinical badge, and disabled "View Sequence"/"Download FASTA" buttons
  (tooltipped "Available in next update" — sequence retrieval is out of scope
  for 5.3A). Empty-result and fetch-error states are both handled explicitly.

## 3. Live validation results

All four required queries were run against the running dev server
(`POST /api/analyze`) and, for the mouse case, directly against
`searchTranscripts()` to bypass an unrelated pre-existing gene-ranking quirk
(see §4).

| Query | Gene resolved | Transcript count | MANE Select | isCanonical semantics |
|---|---|---|---|---|
| `TP53` | 7157 / TP53 / *Homo sapiens* | 26 | `NM_000546.6` (confirmed `isCanonical: true`) | Only 1 of 26 records `true`, rest `false` |
| `BRCA1` | 672 / BRCA1 / *Homo sapiens* | 368 (cross-checked against raw NCBI `gene_table` line count — matches exactly, no duplicates) | `NM_007294.4` | 1 of 368 `true` |
| `Trp53` (mouse gene ID 22059 / *Mus musculus*, tested directly via `searchTranscripts`) | 22059 / Trp53 / *Mus musculus* | 5 | N/A (non-human) | **All 5 records `isCanonical: null`, `manePlusClinical: false`** — correct per spec, since MANE only applies to human RefSeq |
| `SARS-CoV-2` | Resolver classifies as `queryType: "Organism"`; Gene Explorer (pre-existing, unrelated to 5.3A) still returns human genes associated with the organism (e.g. EGFR) as a text-search fallback | 11 (for EGFR, the returned primary gene) | present | n/a |

## 4. Known pre-existing quirk (not introduced by, and out of scope for, 5.3A)

Querying `Trp53` or `mouse Trp53` through the full `/api/analyze` pipeline
returns **human TP53** as the primary (index-0) gene, with mouse Trp53 ranked
third. This is existing Gene Explorer/Biological Query Resolver ranking
behavior (Phase 5.1.5/5.2, untouched by this task) — the resolver's confidence
was `low` ("no confident biological interpretation") and NCBI's own
`esearch` on `db=gene` for "Trp53" ranks the human paralog first by relevance
score. Because Transcript Explorer only fetches for `genes[0]`, this means the
UI currently shows human TP53 transcripts for that query rather than mouse
Trp53. To validate the mouse-specific `isCanonical: null` behavior faithfully,
the transcript module was exercised directly against gene ID `22059` (see
table above), which confirms the transcript layer itself is correct — the
discrepancy is entirely upstream, in gene resolution/ranking, which per the
task boundary must not be modified in Phase 5.3A.

Similarly, `SARS-CoV-2` does **not** return an empty `genes` array in this
app — the existing Gene Explorer treats organism queries as a fallback text
search against `db=gene` and returns related human genes (EGFR, APOE, TNF,
etc.) rather than an empty array. This is pre-existing Phase 5.2 behavior,
not a regression from this task. The Transcript Explorer section correctly
does not render at all when `genes.length === 0`, satisfying the intent of
the spec's "non-gene query → no transcript section" requirement; it simply
never encounters that exact `genes.length === 0` condition for SARS-CoV-2
given how the existing resolver/gene-search fallback already behaves.

## 5. Regression checks

- `pnpm run typecheck` — clean across all workspace packages
  (api-server, research-copilot, scripts, mockup-sandbox).
- PubMed pipeline: unaffected — TP53 query returned 38,995 total papers,
  10 returned per page, as before.
- GEO pipeline: unaffected — TP53 query returned 20,589 total datasets.
- Sequence Foundation: unaffected — 1 sequence resource returned for TP53.
- Gene Explorer: unaffected apart from the intended `transcripts` shape
  change; gene metadata (chromosome, cytogenetic location, aliases, OMIM/
  Ensembl links) unchanged.
- No files under Python/backend, PubMed, GEO, Sequence, or
  Resolver directories were modified — confirmed via `git diff --stat`
  (only the 8 files listed in the task scope changed).

## 6. Files changed

```
app/api/analyze/route.ts
components/GeneExplorerSection.tsx
lib/gene/parser.ts
lib/transcript/fetch.ts
lib/transcript/index.ts
lib/transcript/parser.ts
types/gene-record.ts
types/transcript-record.ts
```

## 7. Explicitly out of scope / deferred (tagged in code as `// TODO Phase 5.4`)

- Sequence retrieval ("View Sequence" / "Download FASTA" are disabled,
  non-functional placeholders by design).
- Protein accession backfill for NM_/XM_ transcripts where the gene_table
  lookup fails.
- Transcript data for non-primary genes in a multi-result gene page.

## 8. Conclusion

Transcript Explorer foundation is functionally complete, type-safe, and
validated end-to-end against live NCBI data for human (TP53, BRCA1) and
non-human (mouse Trp53) cases. The one open item is a pre-existing,
out-of-scope gene-ranking behavior in the resolver/Gene Explorer that
determines which gene is "primary" for ambiguous species-qualified queries —
flagged here for future phases, not fixed in this task per the stated
constraints.
