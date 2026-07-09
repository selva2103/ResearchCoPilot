# Phase 5.4B — Continuation Session: Current-State Verification

Written before any implementation edits in this session, per the FIRST ACTION
instructions. All findings below are from direct inspection of the repository,
not from the prior session's claimed status.

## 1. File existence check

| Claimed file | Exists? | Notes |
|---|---|---|
| `types/research-context.ts` | ✅ Yes | Present, matches spec (generic `ResearchContext<T>` + `ProteinResearchContext`). Pure domain model, no JSX/UI code. |
| `lib/protein/research-context.ts` | ✅ Yes | Present. Pure derivation functions: `deriveSummary`, `deriveRoleChips`, `deriveCanonicalExplanation`, `computeAnnotationConfidence`, `mapResolutionConfidence`, `deriveBiologicalImportance`, `buildRelationships`. No network calls inside. |
| `lib/protein/index.ts` extended with orchestrator | ✅ Yes | `getProteinResearchContext()` and `isResearchContextCached()` added, additive only — `getProteinsForTranscripts` and `getProteinDetail` (5.4A) untouched. In-process cache keyed `researchcontext:protein:{accessionVersion}`, result frozen with `Object.freeze`. |
| `app/api/protein/research-context/route.ts` | ✅ Yes | Present, POST route, validates accession/body fields, rate-limits via shared module-level chain, caches. |
| "TypeScript compiled with zero errors at that point" | ❌ **False as currently committed** | See §2 below — this claim does not hold for the current `HEAD` commit. |
| UI threading through `GeneExplorerSection`/`TranscriptRow`/`ProteinPanel` — "IN_PROGRESS" | ⚠️ **Partially true, but broken** | See §3 below. |

## 2. TypeScript baseline (before any edits this session)

Ran `pnpm --filter @workspace/research-copilot exec tsc --noEmit -p .` before
touching any code. Result: **1 compile error**, in `components/GeneExplorerSection.tsx`:

```
components/GeneExplorerSection.tsx(866,13): error TS2322: Type '{ ... geneRecord: GeneRecord; normalizedQuery: NormalizedQuery | null; }' is not assignable to type
'IntrinsicAttributes & { transcript: TranscriptRecord; isCoding: boolean; proteinRecord: ...; proteinSummaryLoading: boolean; proteinSummaryError: string | null; }'.
  Property 'geneRecord' does not exist on type ...
```

So the "zero errors" claim reported by the prior session does **not** hold for
the current committed state. This is a real, reproducible discrepancy between
claimed and actual status.

## 3. Git state — uncommitted changes and commit history

- `git status`: **no uncommitted changes to any source file.** The only
  modified/untracked paths are Next.js build cache artifacts under
  `artifacts/research-copilot/.next/` (webpack cache, hot-update files, trace) —
  these are build output, not source, and are irrelevant to this phase.
- This means the broken state found in §2 is **already committed** — it is not
  an uncommitted mid-edit fragment left behind when credits ran out. The prior
  session committed `GeneExplorerSection.tsx` in a state where:
  - The call site (`<ProteinPanel geneRecord={geneRecord} normalizedQuery={normalizedQuery} ... />`)
    was updated to pass the new props.
  - The `ProteinPanel` function's parameter/prop type was **not** updated to
    accept them.
  - `ProteinPanel`'s body has **no Research Context rendering at all** — no
    fetch call to `/api/protein/research-context`, no expandable subsection,
    nothing referencing `ProteinResearchContext`.
- `git log --oneline` shows a single relevant commit: `Phase 5.4B Session 1:
  Research Context foundation completed`. There is no second commit showing
  further UI work — the UI threading work was **not committed** beyond this
  broken intermediate state.
- Conclusion: Step F resumes from **"call site partially wired, consuming
  component not started."** The foundation (types, derivation, orchestrator,
  route) is solid and untouched in this session; the UI subsection itself has
  not been built yet.

## 4. Route pattern comparison

Compared `app/api/protein/research-context/route.ts` against the existing
`app/api/protein/detail/route.ts` (5.4A on-demand GenPept fetch):

- Both use the same **module-level sequential rate-limit chain** pattern
  (`withDetailRateLimit` / `withContextRateLimit`) built on
  `GENE_RATE_DELAY_MS` / `sleep` from `lib/gene/search`.
- Both validate the accession with the same `PROTEIN_ACCESSION_RE =
  /^(NP_|XP_)\d+\.\d+$/` regex.
- Both return `{ error, rateLimited? }` with the same status-code convention
  (400 invalid input, 429 rate limited, 502 upstream failure, 200 success).
- The research-context route additionally validates `transcriptRecord` and
  `geneRecord` presence (needed inputs the detail route doesn't require) and
  adds a cache-hit short-circuit via `isResearchContextCached()` before
  invoking the rate limiter — this is a **justified, additive** extension of
  the existing convention (skip the NCBI call entirely when already cached),
  not a new architecture.
- **Conclusion: the route follows the existing convention already established
  by 5.4A's detail route.** No novel pattern introduced; no discrepancy to flag.

## 5. Scope for this session

Given the above, Step F work in this session is:
1. Fix `ProteinPanel`'s prop type to accept `geneRecord` and `normalizedQuery`
   (already being passed by the caller) — this alone resolves the current
   compile error.
2. Build the actual "Research Context" expandable subsection inside
   `ProteinPanel`, above the existing raw-fields detail panel, per the Phase
   5.4B UI spec (lazy fetch on explicit expand, summary, role chips, two
   confidence indicators, canonical/isoform explanation, biological
   importance if grounded, relationships chain, quiet error fallback).

No changes are needed to `types/research-context.ts`, `lib/protein/research-context.ts`,
or `lib/protein/index.ts` — all three were verified correct and are left untouched.
