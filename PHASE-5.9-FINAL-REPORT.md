# Phase 5.9 Final Report: Protein-Protein Interaction Explorer (STRING)

Branch: phase-5.9-ppi-explorer (from phase-5.8a-complete). Code last changed in the licence label commit listed under Commits; tag phase-5.9-complete.

## Scope
- 5.9A: POST /api/protein/interactions (STRING interaction partners; RefSeq to UniProt to STRING ID; minimum score 0.4 / 0.7 / 0.9) and the Protein Interactions panel, mounted after Protein Structure.
- 4d3de1b: protein ESummary split into chunks of 100 accessions (HTTP 414 for genes with 300+ proteins, e.g. BRCA1).
- 5.9B: POST /api/protein/interaction-analysis (network statistics and GO Biological Process enrichment) and StringNetworkExplorer: Open in STRING link, SVG / PNG / TSV export links, static SVG preview, interactive STRING embed (default since 6decc50, static image as fallback), edge style choice, GO terms linked to AmiGO and QuickGO.
- 5.9C: hardening tests (failure injection, threshold filter, sweep).

## Verified (command output or screenshot seen)
- At 452f546: typecheck exit 0; pnpm build BUILD_EXIT=0 (27/27 pages, both interaction routes listed).
- scripts/check_string_failures.ts: 5 of 5 passed. HTTP 500 rejects after 1 call; HTTP 429 retried (3 calls) then rejects; network error rejects; 200 with invalid JSON rejects; a live call afterwards works (STRING v12.5), so the limiter recovers.
- Threshold, API level (TP53, NP_000537.3, limit 50, scores 400 / 900 / 990 / 999): HTTP 200, 50 partners each time, lowest score 0.999, no partner below the threshold. The filter removed nothing here because TP53's top 50 are all very high confidence.
- Threshold, browser (screenshots, TM2 domain-containing protein 2): 20 partners at 0.4 (first 20 shown), 2 at 0.7, 2 at 0.9 (TM2D1 0.979, UQCC2 0.933).
- Partner-name click (screenshot): TM2D1 search opens, Homo sapiens, ncbi-gene:83941, HIGH confidence.
- MT-CO1 (screenshot): resolves to COX1 (Gene ID 4512); Transcripts and Proteins show Unavailable, so no interactions panel appears.
- YP_ accession: the route rejects YP_003024028.1 with "Invalid or missing protein accession (expected NP_/XP_ versioned accession)". The HTTP status code was not seen.
- Code review of lib/protein/interaction-fetch.ts: failures return sourceStatus "error" / availability "source-failure" before writeCache, so errors are never cached; only unresolved, empty and success results are cached; fetchWithRetry retries HTTP 429 only (2 retries, 1.5 s then 3 s); AbortSignal.timeout of 25 s is one budget per STRING call; the limiter keeps working after a failure; getStringVersion never throws and returns null on failure.
- The 5.9 diff touches no file under lib/resolver.
- scripts/regression_matrix.ts at 0eeff49 (code identical to 452f546): 95 checks, 0 failures, REGRESSION MATRIX PASSED (run twice, same result).

## Reported in earlier sessions (output seen by the earlier agent, not in this session)
- 4d3de1b: BRCA1 returns 368 records in 6.1 s with order kept; BRCA2, TP53, EGFR, TTN, DMD unchanged.
- 893581d: TP53 analysis returned 11 nodes, 13 edges, expected edges 5, p = 0.0024, 8 GO Process terms; repeat call 0.01 s (cache); five 400-error cases behave.
- 17-check sweep (SWEEP_OK): TP53 and BRCA1 20 partners at 0.4 / 0.7 / 0.9; INS, EGFR and mouse Trp53 resolve; unknown accession and taxon mismatch are unresolved with no partners; 3 concurrent requests took 8.3 s and all succeeded; analysis route works at 0.4 and 0.9; 13 IDs returns 400.

## Known limits and open items
- Under a STRING outage one request makes up to 3 STRING calls of up to 25 s each, so the "temporarily unavailable" message can take over a minute.
- Only HTTP 429 is retried; 5xx, network errors and timeouts fail once (design choice, not changed).
- The result cache is in memory, per process, with a TTL and no size cap.
- The panel shows the first 20 partners; more may exist.
- Network statistics and GO enrichment describe the query protein plus its top 10 partners (a neighbourhood), not the protein alone. The panel says so.
- Only human partners are clickable (a name search, not a confirmed match).
- The interactive embed loads an external script from string-db.org; if it fails, the static image and links still work.
- Human mitochondrial genes (e.g. MT-CO1, resolved as COX1) have no transcripts or proteins in the app, so they get no interactions panel. YP_ proteins are not supported (route accepts NP_/XP_ only).
- Search box keeps the old text after a partner click (same open item as 5.8A).
- STRING data is licensed CC BY 4.0 (credit STRING, indicate changes; confirmed on STRING's licence page on 4 November 2026). The interactions panel footer shows Data: STRING, its version and (CC BY 4.0). Material from other resources that STRING displays stays under those resources' own terms.

## Not verified
- Browser console and CORS output for the interactive embed after 6decc50.
- Retry buttons and error messages of the network analysis section in the browser.
- Non-human organism in the browser (mouse Trp53 checked at API level only).
- The status mapping in getProteinInteractionResult under mocked failures (only the fetch layer was mocked; the mapping was read in code).

## User-reported only (no output or screenshot)
- Opening a second protein's interactions closes the previous network.

## Commits phase-5.8a-complete..452f546 (oldest first)
c0e32eb feat(interactions): STRING interaction partners API and panel component (not yet mounted)
be39af8 feat(interactions): mount STRING protein interactions panel after Protein Structure
4d3de1b fix(protein): split protein ESummary into chunks of 100 accessions (HTTP 414 for genes with 300+ proteins, e.g. BRCA1)
893581d feat(interactions): STRING network analysis route (PPI stats and GO Process enrichment)
04bb1bd feat(interactions): STRING network view, exports, interactive embed and network analysis in the interactions panel
6decc50 feat(interactions): interactive STRING network by default with static fallback; GO terms link to AmiGO and QuickGO
452f546 docs(protein): update comments for chunked protein ESummary (100 accessions per call)

Later commits: 0eeff49 (this report and the 5.8A report); the licence label commit (STRING data licence CC BY 4.0 shown in the panel footer, text only).

## Diffstat phase-5.8a-complete..452f546
 12 files changed, 1419 insertions(+), 7 deletions(-)
END OF REPORT
