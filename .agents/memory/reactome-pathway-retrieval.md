---
name: Reactome pathway retrieval
description: Reactome Analysis Service POST endpoint accepts gene symbol directly; WikiPathways is inaccessible; NCBI ELink is insufficient (7% completeness).
---

## Rule
Use `POST https://reactome.org/AnalysisService/identifiers/` with gene symbol as plain-text POST body. Do NOT use WikiPathways (dead) or NCBI ELink (7% complete).

**Why:** Phase 5.6B audit tested all available sources:
- Gene EFetch XML: zero Reactome/WikiPathways cross-references
- NCBI ELink `llinks`: 12 R-HSA entries for TP53 vs 180 from direct Reactome call (~7%)
- WikiPathways webservice.wikipathways.org: ALL endpoints 404/406 (migrated/dead)
- WikiPathways SPARQL: HTTP 406
- Reactome Analysis Service: 180 human + 51 mouse pathways from gene symbol directly

**How to apply:** Any future pathway retrieval should use Reactome Analysis Service only. The gene symbol is already available in GeneRecord.officialSymbol — no new identifier mapping needed.

## Reactome Analysis Service Details
- URL: `https://reactome.org/AnalysisService/identifiers/?interactors=false&sortBy=ENTITIES_PVALUE&order=ASC&resource=TOTAL&pValue=1&includeDisease=true`
- Method: POST, Content-Type: text/plain, body = gene symbol string
- Response field `stId` = canonical pathway ID (e.g. R-HSA-6804754 for human, R-MMU-* for mouse)
- Species auto-determined from symbol — no organism parameter needed
- sourceUrl: `https://reactome.org/PathwayBrowser/#/{stId}`
- Rate limit: 500ms between requests (independent from NCBI 350ms chain)
- Cache key: `pathway:{geneId}`, 24h TTL

## Non-Human Coverage
Confirmed: Trp53 (mouse, geneId=22059) returns 51 R-MMU-* pathways with organism="Mus musculus". Non-human queries must NOT default to "unsupported" — Reactome covers model organisms natively.
