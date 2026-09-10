# Phase 5.7B — Findings

## Status

Phase 5.7B (Protein Domains Hardening) completed successfully. Steps 1–6 all ran.
No source-code bugs were found that required a fix; the 5.7A architecture held up
under every validation item in Steps 1–4.

## Baseline note (supersedes earlier content above)

The prior content in this file documented a Step 0 stop caused by a local/remote
hash mismatch and, later, a claimed "Replit package firewall" dependency blocker.
Both are **historical and no longer applicable** in this environment:

- Local HEAD and `origin/main` currently resolve to the same commit
  (`87d7b8d`), confirmed in Step 0.
- `pnpm install --frozen-lockfile` + `pnpm run typecheck` pass cleanly across all
  four relevant workspaces (api-server, mockup-sandbox, artifacts/research-copilot,
  scripts). The firewall claim was independently verified as historical and is not
  re-investigated here.

## Bugs found

None. No source file was modified during this phase (`git diff` on all tracked
`lib/`, `app/`, `types/`, `components/` files is empty after validation).

## Observations (not bugs; no action taken per Architecture/Freeze rules)

1. **`ProteinDomain.source` type is looser than the implementation.**
   `types/protein-domain.ts` declares `source: "genpept-features" | "interpro"`,
   but only `"interpro"` is ever emitted (`domain-fetch.ts` hardcodes it). The
   `"genpept-features"` member is dead — a leftover from the 5.7A source-selection
   audit in which GenPept was evaluated and rejected. Not a runtime bug; left
   unchanged per the freeze rule (no type reshaping during hardening).

2. **Route `cached` field is always `false`.**
   `app/api/protein/domains/route.ts` returns `cached: false` verbatim in all three
   response shapes (success, Case A, Case B), so it never reports an actual cache
   hit. This is exactly what 5.7A shipped and is unchanged — it neither leaks cache
   implementation details nor breaks the contract. Recorded for future phases;
   deliberately not "fixed" because the contract must remain identical to 5.7A.

3. **UniProt poll budget is marginal under upstream load.**
   `MAX_POLL_ATTEMPTS = 12` at `POLL_INTERVAL_MS = 2000` yields a 24s budget.
   During Step 1, BRCA1 (`NP_009228.2`) intermittently exceeded this budget on a
   first attempt and threw `did not complete within 12 attempts`, then resolved
   correctly on retry. This is correct behavior (transient timeout is thrown and
   NOT cached — see Edge Case 14), but confirms the budget sits close to UniProt's
   worst-case latency. No change made; this is a documented policy, not a defect.

4. **Pagination path remains unexercised by real data.**
   The InterPro `page_size=200` multi-page loop (`while (nextUrl)`) is correct, but
   every protein tested — including titin (`Q8WZ42`, 47 entries) — fits on one page.
   Titin's 47 entries expand to 3,134 `ProteinDomain` objects (repeated Ig/Fn domains
   yield many fragments), so "large domain set" is exercised via fragment expansion,
   not via the entry pagination branch. Consistent with 5.7A's known limitation; no
   production logic was modified to manufacture a multi-page case.

## Out-of-scope findings (deferred, not implemented)

Per the phase's explicit exclusion list, none of the following were touched:

- AlphaFold (Phase 5.8), PDBe, STRING, BioGRID, structure visualization.
- Any additional domain data source, new `ProteinDomain` fields, or new UI section.
- Promotion of `ProteinIdentifierResolver` to Frozen Architecture — remains
  **provisional**, freeze eligibility still deferred to after Phase 5.8.