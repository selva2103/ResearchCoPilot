# Phase R — Patch Report: Case-Sensitive Species Symbol Resolution

Date: 2026-07-10

## 1. Root cause (confirmed per FIRST ACTION)

This was root cause **(a)**: the resolver ignored case entirely for bare
(no-organism-stated) queries and matched a default organism (human) first —
compounded by a second, more precise mechanism than "just ignoring case":

- `lib/resolver/index.ts` (`_resolveQuery`, the bare-query branch that builds
  `wholeStringCandidate`) **uppercased** any mixed-case bare symbol shaped
  like a gene token before ever calling `resolveGene`. `"Trp53"` became
  `"TRP53"` at this point — the original case was destroyed before the
  resolver ever had a chance to notice it didn't match the human ALL-CAPS
  convention.
- `lib/resolver/gene.ts` (`resolveGene`, Step 1, "Search in Homo sapiens")
  then ran `TRP53[sym] AND Homo sapiens[orgn]` against NCBI Gene. This
  succeeded — not because `"TRP53"` is human TP53's real symbol (it isn't;
  human's real symbol is `"TP53"`, a different string), but because NCBI's
  `[sym]` field search matches historical aliases too, and `"TRP53"` is
  registered as a historical alias of human Gene ID 7157. Step 1 doesn't
  require the match to be the officially-cased *current* symbol — it accepts
  the first result once the organism-restricted search returns anything —
  so it confidently (0.92) returned human TP53.

Confirmed via direct NCBI ESearch calls during investigation:
`TRP53[sym] AND Homo sapiens[orgn]` → count 1, ID 7157 (human TP53, via
alias). `TRP53[sym]` (no organism filter) → 5 hits including ID 22059
(mouse, whose real symbol is exactly `"Trp53"`).

So the fix needed two things: (1) stop discarding the original case before
`resolveGene` sees it, and (2) inside `resolveGene`, check for a genuine
*exact-case* official-symbol match against a non-human organism before
falling back to the human step that only checks aliases case-insensitively.

## 2. Exact fix applied

**`lib/resolver/index.ts`** — `wholeStringCandidate` now preserves the
query's original case when it's mixed-case-but-symbol-shaped, instead of
uppercasing it:
```ts
const wholeStringCandidate = GENE_SYMBOL_RE.test(q)
  ? q
  : GENE_SYMBOL_RE.test(q.toUpperCase()) && /\d/.test(q)
  ? q                 // was: q.toUpperCase()
  : null;
```

**`lib/resolver/gene.ts`** — `resolveGene`:
- The bare-query symbol guard now also accepts a mixed-case candidate that
  becomes symbol-shaped once uppercased (mirrors the existing allowance
  already used for the `detectedOrganism` path — no new acceptance rule
  invented, reused the same shape check).
- New **Step 0a** runs only when no organism was explicitly stated AND the
  query's case doesn't already match the human ALL-CAPS convention AND the
  query starts with an uppercase letter (i.e. looks like a genuine
  species-convention symbol, not an all-lowercase synonym like `"p53"`).
  It checks each known non-human model organism from the resolver's existing
  canonical organism table (`organism-synonyms.ts` — the same table
  `organism-prefix.ts` already uses; not duplicated), via the identical
  taxId-filtered `ESearch`/`ESummary` pattern Step 0 already uses for
  explicit-organism queries. For each organism, if any result's official
  symbol (`entry.name`) is an **exact, case-sensitive** match to the query,
  that organism/gene pairing is returned at confidence 0.92
  (`resolutionPath: "ncbi-gene-case-convention"`) — before Step 1's
  case-insensitive/alias-tolerant human search ever runs. Mouse (10090) and
  rat (10116) are probed first since they're the organisms this patch
  targets, keeping the common case fast. If no organism has an exact-case
  match, execution falls through unchanged to Step 1 (human) exactly as
  before.
- All-lowercase queries (e.g. `"p53"`) and already-all-caps queries (e.g.
  `"TP53"`) never enter Step 0a (its guard requires `trimmedOriginalCase !==
  trimmedOriginalCase.toUpperCase()` and a leading uppercase letter), so they
  are completely unaffected and take the exact same code path as before this
  patch.
- No hardcoded gene-symbol mapping was added anywhere — every organism/gene
  pairing is confirmed live via NCBI Gene ESearch + ESummary, the same calls
  already used elsewhere in this file.

## 3. Validation results (actual before/after)

| # | Query | Before | After |
|---|---|---|---|
| 1 | `"Trp53"` (bare) | GeneID `7157` (human TP53), confidence 0.92, evidence: `ncbi-gene-exact-human` | **GeneID `22059` (Mus musculus Trp53)**, confidence **0.92**, evidence: `"Gene symbol confirmed via NCBI Gene (ncbi-gene-case-convention), organism=Mus musculus."` |
| 2 | `"TP53"` (bare) | GeneID `7157` (human), confidence 0.92 | **Unchanged**: GeneID `7157` (human), confidence 0.92, `ncbi-gene-exact-human` |
| 3 | `"Tp53"` (bare) | GeneID `7157` (human — same alias bug) | **GeneID `24842` (Rattus norvegicus Tp53)**, confidence **0.92**, `ncbi-gene-case-convention` — rat is a supported organism in this app (`organism-synonyms.ts`) |
| 4a | `"Trp53 Mus musculus"` (explicit organism) | GeneID `22059`, confidence 0.97, `ncbi-gene-organism-prefix` | **Unchanged**: identical GeneID, confidence, and resolution path |
| 4b | `"TP53 human"` (explicit organism) | GeneID `7157`, confidence 0.97, `ncbi-gene-organism-prefix` | **Unchanged**: identical GeneID, confidence, and resolution path |
| 5 | `"p53"` (synonym, all-lowercase — no organism-convention shape) | GeneID `7157` (human TP53), confidence 0.92, `ncbi-gene-exact-human` | **Unchanged**: identical GeneID, confidence, and resolution path (Step 0a's guard excludes all-lowercase queries) |
| 6 | Downstream: re-query `"Trp53"` bare | Gene Explorer / Transcript / Protein data was for human TP53 | Confirmed via `/api/analyze`: `genes[0]` now returns `geneId: "22059"`, `officialSymbol: "Trp53"`, `organism: "Mus musculus"`, `fullName: "transformation related protein 53"` — the corrected mouse GeneID flows through to the gene payload the frontend consumes for Gene/Transcript/Protein Explorer |

All 6 validation items pass with live evidence from the running dev server
(no mocked data) — same-session before/after captured via direct
`/api/analyze` calls and workflow logs.

## 4. Regression results

- `"Trp53 Mus musculus"` and `"TP53 human"` (explicit-organism queries) —
  confirmed byte-for-byte unaffected (same GeneID, confidence, resolution
  path) both before and after the patch.
- `"TP53 breast cancer"` (gene + disease merge, Bug 1/7 collision rule) —
  confirmed unaffected: `gene.geneId: "7157"`, `disease.name: "breast
  cancer"`, confidence `0.85`, same as the documented Phase R behavior.
- `"mouse CD4"` (organism-prefix path) — confirmed unaffected: GeneID
  `12504`, Mus musculus, confidence `0.97`.
- `"BRCA"` (ambiguity handling) — confirmed unaffected: still resolves
  ambiguously (`ambiguous: true`, ID `37916`/Drosophila `Brca2` selected as
  `best`, matching pre-existing ambiguous-selection behavior — this query
  is all-uppercase so it never enters the new Step 0a code path at all).
- TypeScript — `npx tsc --noEmit -p .` passes with zero errors (checked
  after every substantive change in this session, and again as the final
  step before commit).
- No Python changes. No AI-generated result sections (`emergingAreas`,
  `researchGaps`, `projects`, etc.) touched. `NormalizedQuery`'s shape,
  `computeConfidence`, and Phase 5.4B's derivation code
  (`lib/protein/research-context.ts`) were **not modified** — confirmed by
  diff review; this patch only touched `lib/resolver/gene.ts` and
  `lib/resolver/index.ts`.

## 5. No hardcoded gene-symbol list

Confirmed: the fix is a general case-convention matching *strategy*, not a
lookup table of known genes. The only new static data referenced is the
resolver's existing organism table (`organism-synonyms.ts` — taxIds and
scientific names for known model organisms, already used elsewhere in this
codebase for explicit-organism detection). No gene symbol, GeneID, or
species-symbol mapping was hardcoded; every gene/organism pairing this patch
returns is confirmed live via NCBI Gene ESearch + ESummary at request time,
using the exact same helper functions (`geneESearch`, `geneESummary`)
already used by every other resolution path in `gene.ts`.

## Files modified

- `artifacts/research-copilot/lib/resolver/gene.ts` — added Step 0a
  (case-convention species check) to `resolveGene`; broadened the bare-query
  acceptance guard to allow mixed-case symbol-shaped queries through to that
  check; added the organism-table import.
- `artifacts/research-copilot/lib/resolver/index.ts` — preserve original
  case when building `wholeStringCandidate` for a mixed-case bare
  gene-symbol-shaped query, instead of uppercasing it.

## Code review note

A review pass flagged that the broadened bare-query acceptance guard in
`resolveGene` (which admits any token that becomes symbol-shaped once
uppercased, regardless of starting case) could let all-lowercase queries
like `"trp53"` through where they previously wouldn't. Verified this is not
a behavior change: that admission rule already existed pre-patch (`index.ts`
already uppercased and passed such tokens into `resolveGene`, whose own
uppercase-only guard trivially passed on the already-uppercased string).
Step 0a explicitly excludes non-uppercase-first queries
(`/^[A-Z]/.test(trimmedOriginalCase)`), so `"trp53"` still falls straight
through to the unchanged Step 1 human search. Confirmed via live request:
`"trp53"` resolves to human TP53 (GeneID 7157, confidence 0.92,
`ncbi-gene-exact-human`) — byte-identical to its pre-patch resolution.
Tightening the guard to require a leading uppercase letter was tried and
rejected: it broke the pre-existing (and still-required-unaffected)
`"p53"` fallback path, which also relies on this same admission rule to
reach Step 1.

## Performance note

Step 0a probes non-human organisms sequentially (respecting NCBI's rate
limit, same `RESOLVER_RATE_DELAY_MS` used everywhere else in this file) and
only runs for bare, mixed-case, non-all-caps queries — it does not affect
already-all-caps queries, all-lowercase synonym queries, or
explicit-organism queries. Mouse and rat are checked first since they are
the organisms this patch targets, so the common case (`"Trp53"`, `"Tp53"`)
resolves after checking at most 1–2 organisms rather than the full list.

## Completion status

Fixed, validated against the running application (all 6 validation items),
and regression-tested against the previously-passing Phase R queries.
TypeScript compiles cleanly. Scope was kept to gene-symbol-to-organism
matching in `lib/resolver/gene.ts` and `lib/resolver/index.ts` only — no
other resolver or Phase 5.4B code was touched.
