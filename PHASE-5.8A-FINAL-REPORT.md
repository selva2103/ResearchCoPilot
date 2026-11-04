# Phase 5.8A Final Report: Protein Structure (+ hyphenated gene-symbol fix)

Branch: phase-5.8a-protein-structure (from phase-r-gene-resolution-fix-20261016, HEAD 54c592c).
Local commits only; nothing pushed.

## Scope
- POST /api/protein/structure (AlphaFold DB + RCSB PDB, independent sources, 24 h caches, separate limiters).
- GET /api/protein/structure/download (allowlisted URL templates).
- POST /api/protein/search-by-name (UniProt candidates for unresolved queries; never auto-resolves).
- UI: Protein Structure panel, Mol* viewer, chain selection, RCSB link, download dropdown, resolver-degraded state, unresolved/ambiguous wording, transcript no-table reason.
- Resolver fix 1655547: hyphenated human gene symbols (HLA-A, NKX2-1, MT-CO1, MT-ND1, MT-CYB, MT-ATP6).

## Verified (command output seen)
- At b23905b: typecheck exit 0; regression matrix 95 checks, 0 failures, twice; build BUILD_EXIT=0; lib/resolver unchanged since 54c592c.
- At 1655547 (resolver changed): typecheck exit 0; scripts/check_hyphen.ts 18 passed, 0 failed; regression matrix 95 checks, 0 failures, twice (run back to back, no other NCBI traffic).
- Hyphen check covers: HLA-A, hla-a, HLA-DRB1, NKX2-1, MT-CO1, mt-co1, MT-ND1, MT-CYB, MT-ATP6 (resolve to the human gene); T-cell, X-ray, real-time, Epstein-Barr (no gene); HIV-1, SARS-CoV-2 (organism); COVID-19 (disease).
- Hyphen rule: whole-string queries only; accepted only for a human (taxid 9606) NCBI Gene entry whose official symbol, nomenclature symbol or exact alias equals the query; no cross-species fallback.
- Download route: PDB 1TUP (cif, pdb) and AlphaFold AF-P04637-F1 v6 (cif, pdb) fetched with correct first lines; invalid request returns 400.
- search-by-name API: kinase (10 candidates of 855), TP53 (9), empty query 400, invalid JSON 400, long sentence skipped.
- Browser (screenshots, earlier session): kinase candidates list and click-through to MAP4K1.

## Root cause of the hyphen gap
GENE_SYMBOL_RE (lib/resolver/gene.ts and index.ts) excluded hyphens by design since 2026-07-01. NCBI Gene itself finds these symbols. MT-* genes have a different official name (COX1, ND1, CYTB, ATP6); the hyphenated form is in the nomenclaturesymbol field.

## Known limits and open items
- The resolved gene symbol for MT-CO1 is NCBI's name (COX1), not MT-CO1.
- A multi-word query containing a hyphenated symbol (e.g. "HLA-A diabetes") is not handled.
- Alias and nomenclature matches get the same 0.92 confidence as official-symbol matches.
- app/api/analyze/route.ts returns hardcoded sample content that components/ResultsContent.tsx labels "Powered by AI". It must be relabelled or removed.
- Clicking a candidate whose symbol equals the current query is a no-op (same URL).
- Search box keeps the old text after a candidate click.
- Mol* full-controls view shows no sequence strip (unexplained).
- .replit-artifact/artifact.toml does not list /api/protein/structure/download or /api/protein/search-by-name.
- PDB ranking is coverage-first; a full-length lower-resolution structure outranks a partial higher-resolution one.
- 73e768b bundles two fixes.

## Not verified
- pnpm build at 1655547; browser view of MT-CO1 after the fix.
- Non-human fallback in search-by-name (one UniProt HTTP 500 during probing).
- Console/CORS output; sequence strip.

## User-reported only (no output or screenshot)
- Long sentence shows no candidates; TP53 shows no fallback box; Retry; AlphaFold "View 3D"; console errors.

## Commits 54c592c..HEAD (oldest first)
1ee8c66 feat(protein): add Protein Structure panel and /api/protein/structure (AlphaFold DB + RCSB PDB)
336c66f fix(transcript): match protein lines with 'precursor' and other multi-token labels; scan up to 5 lines
f665226 fix(transcript): parse gene_table transcript lines that have no 'transcript variant' label
7b8fb72 fix(ui): surface resolver degraded-state instead of misleading "no match" message
f80823a fix(ui): distinguish unresolved vs. ambiguous protein-identifier states in domain wording
420db46 fix(ui): clarify unresolved-identifier message in Protein Structure panel
7e41596 feat(resolver-ui): UniProt protein-name candidates for unresolved queries
e13416e fix(transcript): reject non-gene_table responses and pass through NCBI's no-table reason
53d71d6 feat(transcript-ui): show NCBI's reason when a gene has no annotated transcripts
4ec2b54 feat(protein): add Mol* 3D structure viewer to the Protein Structure panel
339a01e fix(structure): treat AlphaFold 404 and RCSB 204 as 'no structures', not a source failure
478679e fix(structure-ui): render viewer under the clicked row, select the chain, add empty-source notes
8cf9652 feat(structure-ui): optional full Mol* controls (sequence, components, settings, export)
1d55e09 feat(structure-ui): link PDB rows to RCSB's full 3D view
b23905b feat(structure): download structures as mmCIF, PDB, BinaryCIF (and gzip for PDB entries)
1655547 fix(resolver): resolve hyphenated human gene symbols (HLA-A, MT-CO1)

## Diffstat 54c592c..HEAD
 18 files changed, 2817 insertions(+), 23 deletions(-)
END OF REPORT
