# Phase 5.6B Audit Findings — Pathway Integration (Reactome/WikiPathways)

**Date:** 2026-07-29  
**Conducted:** Before any implementation code was written, per Phase 5.6B Step 1 requirements.

---

## Step 0 — Phase 5.6A Prerequisite Check

**Result: CONFIRMED PRESENT AND WORKING**

All required artifacts verified in repository:
- `PHASE-5.6A-FINAL-REPORT.md` ✅
- `types/functional-annotation.ts` — `FunctionalAnnotation` interface, `EVIDENCE_CODE_LABELS`, helpers ✅
- `lib/gene/go-fetch.ts` — `getGeneGoAnnotations()`, `isGoAnnotationsCached()` ✅
- `lib/gene/go-parser.ts` — `parseGoAnnotations()` ✅
- `app/api/gene/go/route.ts` — `POST /api/gene/go` ✅
- `components/BiologicalFunctionPanel.tsx` — three-aspect collapsible GO display ✅

Live API spot-check before starting: `POST /api/gene/go` with TP53 (geneId=7157) → status=success, count=208. Phase 5.6A confirmed working.

**Proceed to Step 1.**

---

## Step 1 — Mandatory Identifier-Compatibility Audit

### Step 1.0 — Reuse-First Check: Does Gene EFetch XML Contain Pathway Cross-References?

**Method:** Fetched live Gene EFetch full XML for TP53 (geneId=7157, 34MB). Searched for "Reactome", "WikiPathways", and `R-HSA-` / `R-MMU-` pattern strings. Extracted all `Dbtag_db` values.

**Dbtag_db values found in TP53 Gene EFetch XML:**
BioGRID (7704), GeneID (3003), Protein (2281), Nucleotide (1651), HPRD (265), GO (208), BIND (145), UniProtKB/Swiss-Prot (136), UniProtKB/TrEMBL (113), UniSTS (45), Ensembl (40), CCDS (38), CDD (28), HuGENet (26), MIM (15), GTRDisease (12), MedGen (12), GeneReviews (5), taxon (3), HGNC (3)

**Reactome hits:** 0  
**WikiPathways hits:** 0  
**R-HSA-style IDs:** 0

**Conclusion — Reuse-first check: NEGATIVE.** Gene EFetch XML contains NO pathway cross-references (Reactome or WikiPathways). A new retrieval source is required.

Note: Ensembl gene IDs (e.g., ENSG00000141510 for TP53) and UniProt IDs (P04637) ARE present in the Gene EFetch XML and could potentially be used as input identifiers for external pathway services.

### Step 1.1 — Completeness Comparison: NCBI ELink vs Direct Source

**Method:** Tested NCBI ELink `cmd=llinks` for TP53 (geneId=7157), which provides external URL links from NCBI Gene records. Also tested Reactome Analysis Service directly.

**NCBI ELink `llinks` for TP53 (geneId=7157):**
- Total Reactome entries: 12 R-HSA IDs
- These are curated browser links (top-level pathway view links, not all containing pathways)
- Example IDs: R-HSA-74160, R-HSA-1640170, R-HSA-1430728, R-HSA-162582...
- No WikiPathways entries returned from ELink

**Reactome Analysis Service (direct, gene symbol "TP53"):**
- Total pathways returned: **129**

**Completeness gap: 12 (ELink) vs 129 (Reactome direct) = NCBI ELink is ~9% complete.**

**Conclusion — NCBI ELink is NOT sufficiently complete for production retrieval.** NCBI ELink provides only a curated subset of pathway browser links, not the full pathway membership set. A direct Reactome API call is required.

### Step 1.2 — Reactome and WikiPathways Identifier Compatibility Audit

#### Reactome

**API tested:** `POST https://reactome.org/AnalysisService/identifiers/`  
**Identifier submitted:** Gene symbol as plain text (POST body)  
**Results:**

| Gene | Symbol | Organism | Pathways returned | stId prefix |
|---|---|---|---|---|
| TP53 | TP53 | Human | 129 | R-HSA- |
| Trp53 | Trp53 | Mouse | 51 | R-MMU- |

**Non-human coverage confirmed:** Trp53 (mouse) returns 51 R-MMU-* pathways directly from gene symbol. No organism disambiguation needed — Reactome infers species from the submitted identifier.

**Response fields (confirmed):**
- `stId` — canonical stable ID (e.g., "R-HSA-6804754") — used as `pathwayId`
- `name` — pathway display name (e.g., "Regulation of TP53 Expression")
- `species.taxId` — taxonomy ID (e.g., "9606")
- `species.name` — organism name (e.g., "Homo sapiens")
- `inDisease` — boolean (disease pathway flag)
- `entities` — enrichment statistics (not needed for listing)

**sourceUrl construction:** `https://reactome.org/PathwayBrowser/#/${stId}` — confirmed as the correct Reactome browser permalink format (verified from NCBI ELink URL pattern).

**Identifier mapping required?** None. Gene symbol is already available in `GeneRecord.officialSymbol`, resolved upstream by Phase R / Gene Explorer. The Reactome Analysis Service accepts gene symbols directly.

**Architecture Escalation Rule triggered?** No. No UniProt/Ensembl translation dependency needed.

**DECISION: Reactome ACCEPTED as primary source.**

#### WikiPathways

**APIs tested and results:**

| Endpoint | Result |
|---|---|
| `webservice.wikipathways.org/findPathwaysByXref?ids=7157&codes=L` | HTTP 404 |
| `www.wikipathways.org/api/20110601/findPathwaysByXref?ids=7157&codes=L` | HTTP 404 |
| `www.wikipathways.org/wikipathways-api/findPathwaysByXref?ids=7157&codes=L` | HTTP 404 |
| `sparql.wikipathways.org/sparql` (SPARQL query) | HTTP 406 Not Acceptable |
| `www.pathwaycommons.org/pc2/search.json?datasource=wikipathways` | HTTP 404 |

**Conclusion:** All WikiPathways API endpoints tested returned 4xx errors. The webservice.wikipathways.org REST API has been deprecated/migrated; no replacement API is accessible via the tested approaches. WikiPathways data is not retrievable through any working API endpoint tested.

**DECISION: WikiPathways REJECTED — no working API found.**

### Step 1.3 — Summary: Production Retrieval Source

Per the audit findings:
- Gene EFetch XML: NO pathway data
- NCBI ELink: 9% completeness (rejected)
- Reactome Analysis Service: ACCEPTED — 129 human pathways, 51 mouse pathways via gene symbol
- WikiPathways: REJECTED — no accessible API

**Production retrieval source: Reactome Analysis Service only.**

---

## Decision Log

| Source considered | Decision | Reason |
|---|---|---|
| Gene EFetch XML (reuse-first check) | REJECTED | Zero Reactome/WikiPathways cross-references in Gene XML |
| NCBI ELink `llinks` (for Reactome IDs) | REJECTED | Only 12 vs 129 Reactome pathways (~9% complete) |
| Reactome Analysis Service | **ACCEPTED** | 129 human + 51 mouse pathways from gene symbol; no new identifier mapping; species auto-determined |
| WikiPathways webservice REST API | REJECTED | All endpoints returning 404/406; service inaccessible |
| WikiPathways SPARQL | REJECTED | HTTP 406 Not Acceptable |
| PathwayCommons (WikiPathways proxy) | REJECTED | HTTP 404 |

---

## Architecture Notes for Implementation

1. **Identifier used for Reactome:** `geneSymbol` (gene symbol string) — consumed from caller's `GeneRecord.officialSymbol`. Never independently resolved here.

2. **New external host:** `reactome.org` is the first genuinely new external host in this project (not NCBI Entrez family). A dedicated, independent rate limiter scoped to this host is required.

3. **Rate limit strategy:** Reactome Analysis Service is a single POST per gene per request. No published rate limit found; applying 500ms conservative delay between requests. Cache prevents repeat calls (24h TTL, keyed by `pathway:{geneId}`).

4. **PathwayMembership fields:**
   - `pathwayId` ← `stId` (canonical)
   - `pathwayName` ← `name` (display only)
   - `source` ← `"reactome"` (hard-coded, single source)
   - `sourceUrl` ← `https://reactome.org/PathwayBrowser/#/${stId}`
   - `organism` ← `species.name`
   - `geneId` ← from caller
   - `geneSymbol` ← from caller

5. **Volume:** TP53 has 129 pathways — pagination warranted (>20). Step 6 spec requires Universal Pagination Framework or equivalent client-side slice pattern.

6. **Non-human:** Trp53 (mouse) returns 51 R-MMU-* pathways correctly; `inDisease` flag available for optional future use.

7. **WikiPathways `source` field value:** `"wikipathways"` preserved in the type union per spec but unused in this phase's implementation since no working API was found.
