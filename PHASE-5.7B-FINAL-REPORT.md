# PHASE-5.7B-FINAL-REPORT.md
## Protein Domains Hardening — Validation of the 5.7A Architecture

**Date:** 2026-09-10
**Status:** COMPLETE — no source changes, no bugs requiring fixes, all 14 edge cases validated

---

## 0. Baseline Verification (Step 0)

| Check | Result |
|-------|--------|
| Working tree | Clean (only pre-existing untracked `AUDIT-REPORT.md`, out of scope) |
| Branch | `main`, tracking `origin/main` |
| Local HEAD | `87d7b8d` |
| Remote `origin/main` (`git ls-remote`) | `87d7b8d2e2461c10684f174b208de58127014604` |
| Hash match | **Matched** |
| `package.json` / `pnpm-lock.yaml` diff | Zero |
| `pnpm run typecheck` | Pass across all 4 workspaces (api-server, mockup-sandbox, research-copilot, scripts) |
| Browser/UI automation | **Unavailable** in this agent environment (no Playwright/Puppeteer/browser MCP). UI verification recorded as "unavailable"; API-level (`curl` + direct code execution via `tsx`) verification used instead. Absence of browser tooling is not treated as a UI defect. |

Git checkpoint branch `gitsafe-backup/phase-5.7b-hardening` created before any work.

---

## 1. Regression Results (Step 1)

All five regression proteins resolved to their expected UniProt accessions and
returned the expected domain counts. Values match the 5.7A report exactly.

| Protein | RefSeq | Expected UniProt | Actual UniProt | Status | Domains | Distinct Ids | Ordering |
|---------|--------|------------------|----------------|--------|---------|--------------|----------|
| TP53 | NP_000537.3 | P04637 | P04637 | resolved | 27 | 22 | ascending ✓ |
| BRCA1 | NP_009228.2 | P38398 | P38398 | resolved | 48 | 27 | ascending ✓ |
| CFTR | NP_000483.3 | P13569 | P13569 | resolved | 53 | 28 | ascending ✓ |
| EGFR | NP_005219.2 | P00533 | P00533 | resolved | 57 | 39 | ascending ✓ |
| Trp53 (mouse) | NP_035770.2 | P02340 | P02340 | resolved | 25 | 20 | ascending ✓ |

Every returned `ProteinDomain` object kept `proteinAccession` = the RefSeq
accession (canonical) and `uniprotAccession` = the resolved UniProt accession
(traceability). No code path substituted UniProt for RefSeq as the internal ID.

**Unaffected surfaces (confirmed by 5.7A commit range, `81fd148`):**

- Phase R Biological Query Resolver — no files under `lib/resolver/` touched by 5.7A.
- Gene/Transcript/Variant Explorer, Clinical Evidence, Biological Function
  Explorer (GO + Pathways) — untouched.
- 5.4B `Region:`/`Site:` role chips — `lib/protein/research-context.ts` unchanged.
- Gene/Transcript/CDS/Protein FASTA downloads — unchanged.
- Protein Explorer layout/section order — additive-only (Protein Domains panel
  appended; no existing section altered).

Evidence: `git show --stat 81fd148` lists exactly 6 files (route.ts, domain-fetch.ts,
identifier-resolver.ts, protein-domain.ts, GeneExplorerSection.tsx, artifact.toml);
no other application source path appears. `pnpm run typecheck` passes. This phase
made **zero** source changes (`git diff` empty for all tracked source files), so the
above surfaces are by construction untouched since 5.7A.

---

## 2. Edge Case Results (Step 2 — all 14 items)

### 2.1 Zero domains (Case B — resolved, no domains)
**Code path verified; no live trigger found in the regression set (consistent with
5.7A known limitation #1).** `route.ts` returns `{ status: "empty",
resolutionStatus: "resolved", domains: [], count: 0 }` when a resolved protein has
zero InterPro entries; the UI renders "No annotated domains available for this
protein." This is a *distinct* branch from Case A (unresolved). No reviewed Swiss-Prot
protein with zero InterPro member matches was found against live data — expected
(the test proteins all carry annotations). Not a crash, not the unresolved state.

### 2.2 Large domain set
Titin (`NP_003310.4 → Q8WZ42`) resolved and returned **3,134 domains** from 47
distinct InterPro entries (repeated Ig/Fn domains produce many fragments). No
truncation; deterministic ascending ordering held across all 3,134 elements; the
sort completed in milliseconds. UI is lazy (panel collapsed by default), so the
large set is only rendered on demand.

### 2.3 Overlapping domains
TP53 produced 9 overlapping position-groups, e.g. `[3–369]` = `PTHR11447` +
`IPR002117`, `[100–288]` = `PF00870` + `IPR011615`, `[319–357]` = `PF07710` +
`SSF47719` + `IPR010991` (3 signatures). Every distinct signature from a different
member database is preserved; none merged, truncated, or deduplicated.

### 2.4 Non-human proteins
Mouse Trp53 (`NP_035770.2 → P02340`) resolved natively (25 domains), not through
any special-cased path. The resolver is accession-based and species-agnostic;
no species branch exists in `identifier-resolver.ts` or `domain-fetch.ts`.

### 2.5 Malformed/partial InterPro response
`normalizeEntries` (`domain-fetch.ts:206`) skips individual entries with no
`metadata.accession` and emits null-position domains only when location data is
absent. No live malformed entries were returned by InterPro during testing, so the
graceful-degradation path was confirmed by code inspection (skip-and-continue, no
throw) rather than a synthetic fixture.

### 2.6 Pagination
Multi-page loop `while (nextUrl)` (`domain-fetch.ts:176`) is correct. No tested
protein exceeded `page_size=200` at the *entry* level (titin = 47 entries), so the
branch is code-verified but unexercised by real data — identical to 5.7A. No
production retrieval logic was modified to manufacture a multi-page case.

### 2.7 Domain cache correctness
Second lookup of TP53 returned in **0ms** and `isDomainCached("NP_000537.3") === true`,
with the same array reference (`d2 === d1`). TTL check path (`Date.now() - fetchedAt
> 24h`) is exercised by `getCached`; the 24h TTL is verified by code inspection (not
a 24h wait). Same for the resolver cache (`isIdentifierMappingCached`).

### 2.8 Rate limiter isolation
Four independent module-level chains confirmed: `goFetchChain` (go-fetch.ts, 350ms),
`reactomeFetchChain` (pathway-fetch.ts, 500ms), `uniprotFetchChain`
(identifier-resolver.ts, 300ms), `interproFetchChain` (domain-fetch.ts, 400ms). Each
is a separate `Promise<void>` chain; a burst on one does not queue against another.

### 2.9 Deterministic ordering
`sortDomains` (`domain-fetch.ts:287`) sorts by `startPosition` ascending, `domainName`
tiebreaker, null-position entries last. Verified live: ordering stable across repeated
requests (`order1 === order2`), ascending positions observed for all 5 proteins plus
titin, and null-position entries last (titin: `nullPositionsLast === true`).

### 2.10 External links
`domainSourceUrl` (`GeneExplorerSection.tsx:955`) branches on `domainId` prefix
(`IPR`/`PF`/`PS`/`PR`/`PTHR`/`SM`), never on `domainName`; returns `null` for
CDD/SSF/CATH (`cd…`, `SSF…`, `G3DSA:…`). The displayed canonical `domainId` is the
only input to link construction. Verified by code inspection.

### 2.11 ProteinIdentifierResolver validation
- **Successful mapping:** TP53 → `P04637` correct (`resolutionStatus="resolved"`,
  `reviewed=true`).
- **Resolver cache:** repeated `resolveProteinIdentifier("NP_000537.3")` returned the
  same object in 0ms without re-hitting UniProt (`isIdentifierMappingCached` true).
- **Unresolved (0 reviewed):** `XP_011520649.2` → `uniprotAccession=null`,
  `resolutionStatus="unresolved"`, `reviewed=null` — and IS cached (deterministic
  outcome), verified live.
- **Ambiguous (2+ reviewed):** branch returns `uniprotAccession=null`,
  `resolutionStatus="ambiguous"`, never auto-picks. No live protein triggered it;
  branch verified by code inspection (`applyMultiMappingRule`, identifier-resolver.ts:250).
- **Cache key canonical:** `isIdentifierMappingCached("P04637")` and
  `isDomainCached("P04637")` are both `false`; caches are keyed strictly on the RefSeq
  accession, never the UniProt accession or protein name.

### 2.12 Upstream failure classification
Confirmed empty biological results are distinguishable from transient failures:
`resolveProteinIdentifier` and `getProteinDomains` throw on network/HTTP error (and
the route returns HTTP 502, or 429 on rate-limit), whereas empty biological results
return HTTP 200 with `status:"empty"`. During testing, a transient InterPro HTTP 500
and a transient UniProt poll timeout surfaced as *errors* (thrown), never as
`"no domains"` — confirming the two states are kept distinct at both the API and UI
layers.

### 2.13 End-to-end identifier pipeline
Verified: RefSeq `NP_000537.3` → resolved to `P04637`, `P04637` sent to InterPro
(confirmed the InterPro URL contains the UniProt accession), while the returned
`ProteinDomain` objects kept `proteinAccession = "NP_000537.3"` and the cache key
remained `proteindomain:NP_000537.3`. No path substitutes UniProt for RefSeq as the
internal identifier.

### 2.14 Resolver timeout/retry behavior
Verified: a mapping poll timeout throws `did not complete within 12 attempts` and is
**not** cached (the `setCached` call is only reached after `applyMultiMappingRule`
succeeds). A later retry for the same accession succeeds once the transient condition
clears — observed live: BRCA1 timed out on run #1, then resolved `P38398` on run #2.
Timeout (transient) is therefore distinguishable in code from confirmed unresolved
(0 reviewed, which IS cached).

---

## 3. Bugs Found

None. No `git diff` on any tracked source file; no smallest-fix was required.

## 4. Out-of-Scope Findings (deferred)

See `PHASE-5.7B-FINDINGS.md`: AlphaFold/PDBe/STRING/BioGRID, structure visualization,
additional sources/fields/UI, and freezing `ProteinIdentifierResolver` are all
deferred per the phase exclusion list.

## 5. Performance Baseline (Step 3)

| Operation | Cold (ms) | Warm/cached (ms) |
|-----------|-----------|------------------|
| Resolve TP53 (RefSeq→UniProt) | 2,124 | 0 |
| Fetch TP53 domains (InterPro) | 919 | 0 |
| **End-to-end TP53 (resolver + InterPro)** | **~3,043** | **~0** |
| Resolve `XP_011520649.2` (unresolved path) | 12,318 | 0 (cached) |

Reference from 5.7A report (cold end-to-end range): 821–2,966ms across the 5
regression proteins. This phase adds a fresh baseline for future comparison.

## 6. API Contract Confirmation (Step 4)

- `ProteinDomain` and `ProteinIdentifierMapping` types are **unchanged** from 5.7A
  (no export renamed or reshaped).
- `POST /api/protein/domains` request shape `{ accession, geneId, organism }` and
  response shapes (success, Case A empty, Case B empty, error) are **unchanged**.
- The response exposes only `ProteinDomain` fields plus
  `status`/`resolutionStatus`/`uniprotAccession`/`count`/`cached`/`executionTimeMs`
  (success/empty) or `error`/`rateLimited` (error). It does **not** expose upstream
  API credentials, cache internals, or raw UniProt/InterPro payloads.

## 7. ProteinIdentifierResolver Status

`ProteinIdentifierResolver` remains **provisional (not part of Frozen Architecture)**.
Freeze eligibility is still deferred to after Phase 5.8 (second-consumer validation),
per 5.7A's documented provisional-status rule. This phase performs validation only and
does not change that status.