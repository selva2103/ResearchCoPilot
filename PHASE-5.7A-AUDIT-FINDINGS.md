# PHASE-5.7A-AUDIT-FINDINGS.md
## Protein Domains Foundation — Step 1 Mandatory Audit

**Date:** 2026-08-04  
**Auditor:** Phase 5.7A Agent  
**Status:** ⚠️ ARCHITECTURE ESCALATION — STOP before Step 2

---

## 1. Baseline Confirmation

Before any audit work began, the following was verified:

- `git status`: clean (only `.next/` build cache modified)
- `git branch -vv`: on `main`, tracking `origin/main`  
- `git log -1`: `64bd5a1 Update Next.js build artifacts and remove unused route page.`
- `git tag -l "v5.6-complete"`: tag present locally
- `git ls-remote --tags origin v5.6-complete`: `ae9eab2ec929a92c40eee8ff274701521a5d1c78` — **tag confirmed on remote**
- TypeScript: **zero errors** (tsc --noEmit, no output)
- Protein Explorer: confirmed rendering TP53 successfully before implementation began

---

## 2. Reuse-First Check: GenPept FEATURES

### What the existing 5.4B code fetches

Phase 5.4B's `lib/protein/research-context.ts` already fetches GenPept flat-file text for every protein (EFetch `rettype=gp`). This same text is the input to `enrichWithDetail()` and `deriveRoleChips()`. No new NCBI call would be needed if GenPept FEATURES contain sufficient domain data.

### Live inspection: NP_000537.3 (TP53, human)

GenPept FEATURES section (relevant entries):

```
Region          6..30
                /region_name="P53_TAD"
                /note="P53 transactivation motif; pfam08563"
                /db_xref="CDD:462520"
Region          35..59
                /region_name="TAD2"
                /note="Transactivation domain 2; pfam18521"
                /db_xref="CDD:375947"
Region          94..292
                (DNA-binding domain entry, CDD:462519)
Region          363..393
                (tetramerisation, CDD:...)
Site            9
                /site_type="phosphorylation"
...
```

Key observations:
- `/region_name` values are **free-text** (e.g., "P53_TAD", "TADI", "TAD2") — not canonical Pfam/InterPro IDs
- `/db_xref` entries carry **CDD accessions** (e.g., `CDD:462520`) — NCBI-specific, not Pfam or InterPro
- Pfam accession strings (e.g., "pfam08563") appear **only in `/note` prose text**, not as structured db_xref entries — unreliable to parse
- Some Region entries have no `/region_name` at all; others have only interaction partner descriptions

### Live inspection: NP_009228.2 (BRCA1, human)

GenPept FEATURES (domain-relevant entries only):

```
Region          <1..52        /db_xref="CDD:473075"    (no /region_name)
Region          298..461      /db_xref="CDD:463719"    (no /region_name)
Region          1603..1699    /db_xref="CDD:349367"    (no /region_name)
Region          1711..1808    /db_xref="CDD:349353"    (no /region_name)
```

Key observations:
- CDD db_xref entries present with good position ranges
- **Zero `/region_name` qualifiers** for any of the domain-like regions
- No `/note` with Pfam references

### Decision: GenPept FEATURES do NOT meet the bar

Per the spec's decision rule: reuse requires "canonical, stable, accession-bearing domain identifiers (e.g. an actual Pfam/InterPro ID, not just a free-text region name) together with reliable residue boundaries."

- TP53: Has CDD IDs (canonical but NCBI-specific, not Pfam/InterPro) + free-text names
- BRCA1: Has CDD IDs but NO domain names whatsoever
- Pfam IDs in prose notes are not structured and not reliably parseable
- **Verdict: GenPept FEATURES do not qualify** — they lack canonical Pfam/InterPro identifiers and have inconsistent region naming across proteins

---

## 3. InterPro API Investigation

### Endpoint tested: EBI InterPro REST API

Base URL: `https://www.ebi.ac.uk/interpro/api/`

### Test 1: Direct NP_ RefSeq accession (CRITICAL)

```
GET https://www.ebi.ac.uk/interpro/api/protein/uniprot/NP_000537.3/?format=json
→ {"Error": "'WSGIRequest' object has no attribute '_request'"}   (HTTP 200 body, server error)

GET https://www.ebi.ac.uk/interpro/api/protein/reviewed/NP_000537/?format=json
→ {"Error": "'WSGIRequest' object has no attribute '_request'"}   (same)

GET https://www.ebi.ac.uk/interpro/api/entry/all/protein/UniProt/NP_000537.3/?format=json
→ JSON parse error (empty body)
```

**Result: InterPro does NOT support NP_ or XP_ RefSeq accessions. All tested endpoint forms fail.**

### Test 2: UniProt accession — TP53 (P04637)

```
GET https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P04637/?format=json&page_size=200
→ count: 22, next: null, results: 22 entries (all on one page)
```

Sample of results:

| Accession   | Source DB   | Name                                            | Position         |
|-------------|-------------|------------------------------------------------|------------------|
| cd08367     | cdd         | P53 DNA-binding domain                          | 109–288          |
| IPR002117   | interpro    | p53 tumour suppressor family                    | 3–369            |
| IPR008967   | interpro    | p53-like transcription factor, DNA-binding      | 97–287           |
| IPR010991   | interpro    | p53, tetramerisation domain                     | 319–357          |
| IPR011615   | interpro    | p53, DNA-binding domain                         | 100–288          |
| IPR012346   | interpro    | p53/RUNT-type transcription factor, DNA-binding | 95–294           |
| IPR013872   | interpro    | p53, transactivation domain                     | 6–30             |
| IPR036674   | interpro    | p53-like tetramerisation domain superfamily     | 319–360          |
| IPR040926   | interpro    | Cellular tumor antigen p53, transactivation 2   | 35–59            |
| IPR057064   | interpro    | p53, central conserved site                     | 237–249          |
| PF00870     | pfam        | P53 DNA-binding domain                          | 100–288          |
| PF07710     | pfam        | P53 tetramerisation motif                       | 319–357          |
| PF08563     | pfam        | P53 transactivation motif                       | 6–30             |
| PF18521     | pfam        | Transactivation domain 2                        | 35–59            |
| PR00386     | prints      | P53SUPPRESSR                                    | 116–142          |
| PS00348     | prosite     | p53 family signature                            | 237–249          |
| PTHR11447   | panther     | CELLULAR TUMOR ANTIGEN P53                      | 3–369            |
| SSF47719    | ssf         | p53 tetramerization domain                      | 319–357          |
| SSF49417    | ssf         | p53-like transcription factors                  | 97–287           |
| G3DSA:*     | cathgene3d  | (3 entries)                                     | various          |

**Result: InterPro with UniProt accessions returns excellent data — canonical accessions, reliable positions, multi-database aggregation (Pfam, PROSITE, PANTHER, PRINTS, CATH, SSF, CDD).**

**Pagination:** 22 entries for TP53 fit on a single page at page_size=200; `next` is null. No multi-page handling needed for this protein.

### Test 3: UniProt accession — BRCA1 (P38398)

```
GET https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/P38398/?format=json&page_size=200
→ count: 27, results: 27 entries (all on one page, next: null)
```

Sample (first 5): cd16498 (CDD, RING finger, 7–99), cd17721 (CDD, BRCT domain C-terminal, 1758–1855), cd17735 (CDD, BRCT domain N-terminal, 1650–1746), G3DSA:3.30.40.10 (CATH, zinc finger, 1–112), G3DSA:3.40.50.10190 (CATH, BRCT domain, 1646–1755). Full set includes Pfam and InterPro entries too.

**Result: InterPro with UniProt works correctly for BRCA1.**

---

## 4. UniProt Mapping from GenPept Text

### Pattern tested

GenPept flat-file notes sometimes contain: `/note="propagated from UniProtKB/Swiss-Prot (P04637.4)"`

This UniProt accession could be extracted by regex without a new API call, since the GenPept text is already fetched by 5.4B's existing detail endpoint.

### Coverage test across five proteins

| Protein        | NP_ accession  | UniProt in GenPept? | UniProt ID found |
|----------------|----------------|---------------------|------------------|
| TP53 (human)   | NP_000537.3    | ✅ Yes               | P04637.4         |
| EGFR (human)   | NP_005219.2    | ✅ Yes               | P00533.2         |
| CFTR (human)   | NP_000483.3    | ✅ Yes               | P13569.3         |
| Trp53 (mouse)  | NP_035770.2    | ✅ Yes               | P02340.4         |
| BRCA1 (human)  | NP_009228.2    | ❌ **No**            | —                |

BRCA1 (P38398) is a well-studied Swiss-Prot protein, yet its RefSeq GenPept record has **no "propagated from UniProtKB/Swiss-Prot" annotation**. This is a known inconsistency in NCBI's annotation pipeline — not all Swiss-Prot entries have their annotation propagated to RefSeq.

**Result: Extracting UniProt ID from GenPept text is NOT reliable across all proteins.** BRCA1 — a primary regression test case specified in the spec — fails. A reliable UniProt mapping would require an additional API call (NCBI ID converter or UniProt mapping service), which constitutes new mapping infrastructure per the spec's Architecture Escalation Rule.

---

## 5. Decision Log

| Option | Tested? | Canonical IDs? | Position data? | Reliable NP_ coverage? | New infra? | Eligible? |
|--------|---------|----------------|----------------|------------------------|------------|-----------|
| GenPept FEATURES (CDD db_xref) | ✅ | CDD only (not Pfam/IPR) | ✅ Partial | ✅ Yes | No | ❌ Fails decision rule |
| GenPept FEATURES (region_name) | ✅ | ❌ Free-text only | ✅ Yes | ✅ Yes (BRCA1 has none) | No | ❌ Fails decision rule |
| InterPro + direct NP_ | ✅ | ✅ | ✅ | ❌ NP_ not accepted | No | ❌ API doesn't work |
| InterPro + UniProt from GenPept | ✅ | ✅ | ✅ | ❌ BRCA1 fails | Partial | ❌ Incomplete coverage |
| InterPro + UniProt API mapping | Not tested | ✅ | ✅ | Likely ✅ | **Yes — new API** | ⚠️ Escalation |

---

## 6. Architecture Escalation Determination

Per the spec's **Architecture Escalation Rule**:

> "If direct RefSeq protein accession support is NOT available and an additional accession-mapping layer (e.g. UniProt mapping) would be required to use InterPro: STOP and document the incompatibility in PHASE-5.7A-AUDIT-FINDINGS.md instead of introducing new mapping infrastructure without approval."

Findings against this rule:

1. **Direct RefSeq NP_ support in InterPro: NOT available** — confirmed by live API tests above; all NP_ queries return a server-side error regardless of endpoint form used.

2. **Reliable UniProt mapping without a new API call: NOT available** — UniProt accession is present in the GenPept `/note` field for Swiss-Prot-annotated proteins (TP53, EGFR, CFTR, mouse Trp53), but is absent for BRCA1, which is a spec-required regression test protein. Complete coverage requires calling a mapping API that this project does not currently use.

**Verdict: Architecture Escalation applies. Implementation stops here pending review.**

---

## 7. Alternative Paths (for Reviewer Consideration)

Three options are documented here to inform the review decision. No implementation of any option has been started.

### Option A — InterPro with UniProt-from-GenPept (partial coverage)
- Extract UniProt accession from the already-fetched GenPept `/note` text  
- Call InterPro for proteins where the mapping is available; emit an explicit empty state for others  
- **Trade-off:** BRCA1 and any other protein without the "propagated from Swiss-Prot" note would silently return zero domains. This is a correctness risk the spec may not accept.
- **No new external API.** Logic change is parsing-only.

### Option B — NCBI CDD API (within Entrez family)
- CDD is an NCBI Entrez database; ELink `dbfrom=protein&db=cdd` accepts NP_ UIDs and returns CDD entry UIDs  
- CDD EFetch returns domain records with canonical CDD accessions (e.g., `cd08367`) and position data  
- CDD accessions are canonical and stable NCBI identifiers — not Pfam/InterPro, but a recognized domain classification system that appears in GenPept `db_xref` fields throughout this project  
- **Trade-off:** CDD accessions are NCBI-specific, not the InterPro/Pfam canonical layer the spec prefers. Coverage and classification depth differ from InterPro. Two ELink+EFetch steps are needed per protein.
- **No new external host.** Uses existing NCBI Entrez client, same rate-limiter family.

### Option C — InterPro with NCBI ID-mapping service
- Call `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&rettype=acc` or NCBI's ID converter to get UniProt mapping  
- Use UniProt accession to call InterPro  
- **Trade-off:** Requires a new external call pattern; this is the "new mapping infrastructure" the spec explicitly prohibits without approval.

---

## 8. Recommended Path (Agent Recommendation — Not Implemented)

**Option A with a clear empty-state contract** is the lowest-disruption path:
- Works today for the majority of reviewed proteins (TP53, EGFR, CFTR, Trp53, and most Swiss-Prot-annotated RefSeq proteins)  
- Requires only parsing logic (no new API), keeps isolation from NCBI client identical to 5.6B's Reactome pattern  
- Explicitly emits `domains: []` with `source: "interpro"` and `mappingAvailable: false` for proteins without a Swiss-Prot note  
- BRCA1 shows an empty-domains state with an explanatory note rather than crashing  

**Option B** is appropriate if Pfam/InterPro canonical IDs are required and NCBI-only coverage is acceptable; the spec favors InterPro but doesn't exclusively require it.

The agent recommends approval of **Option A** to proceed, or explicit approval of **Option B** if NCBI-only IDs are acceptable.

---

## 9. Files Modified / Added by This Audit

- **PHASE-5.7A-AUDIT-FINDINGS.md** — this file (added)
- **No source code modified**
- **No TypeScript changes**

TypeScript remains at zero errors. Working tree clean (aside from .next/ build cache).

---

## ADDENDUM — v2 Revised Step 1 (2026-08-04)

Following v2 spec revision, the UniProt ID Mapping API was approved as a legitimate
architectural dependency. This section documents the v2 Step 1 verification results.

### UniProt ID Mapping API — Live Verification

**Endpoint:** `POST https://rest.uniprot.org/idmapping/run`  
**Parameters:** `from=RefSeq_Protein`, `to=UniProtKB`  
**Flow:** Submit → Poll status → Fetch results  
**API license:** EBI UniProt — open, freely available.  
**InterPro license:** EBI InterPro — open, freely available.  
**Status:** APPROVED as architectural dependency per v2 spec.

### Per-protein Mapping Results Table

| Protein | Accession | # Mappings | Swiss-Prot entries | TrEMBL entries | Resolution | Selected UniProt |
|---------|-----------|------------|---------------------|----------------|------------|-----------------|
| TP53 (human) | NP_000537.3 | 3 | P04637 (1) | K7PPA8, Q53GA5 (2) | resolved | P04637 |
| BRCA1 (human) | NP_009228.2 | 2 | P38398 (1) | A0A9Y1QQK3 (1) | resolved | P38398 |
| CFTR (human) | NP_000483.3 | 1 | P13569 (1) | none | resolved | P13569 |
| EGFR (human) | NP_005219.2 | 4 | P00533 (1) | F2YGG7, F6QWY5, Q504U8 (3) | resolved | P00533 |
| Trp53 (mouse) | NP_035770.2 | 3 | P02340 (1) | Q3UGQ1, Q549C9 (2) | resolved | P02340 |

**5/5 proteins resolved (100% — above 80% threshold). Decision: proceed with UniProt ID Mapping API.**

**Multi-mapping rule applied:** Each protein mapped to multiple entries but each had exactly one 
Swiss-Prot (reviewed) entry — rule (a) applied in all cases. Rule (b) and (c) paths were not 
triggered by any regression-set protein; they are implemented and verifiable via code inspection.

### Deterministic Multi-mapping Rule (Step 1 decision)

- (a) Exactly 1 reviewed (Swiss-Prot) entry → `resolutionStatus = "resolved"`, select that entry ✓
- (b) 2+ reviewed entries → `resolutionStatus = "ambiguous"`, `uniprotAccession = null` ✓ (implemented)
- (c) 0 reviewed entries → `resolutionStatus = "unresolved"`, `uniprotAccession = null` ✓ (verified via XP_011520649.2)

### InterPro Confirmation (with resolved UniProt accessions)

| Protein | UniProt | InterPro entries | Pagination |
|---------|---------|-----------------|------------|
| TP53 | P04637 | 22 InterPro entries → 27 ProteinDomain objects (some have multiple fragments) | 1 page |
| BRCA1 | P38398 | 27 InterPro entries → 48 ProteinDomain objects | 1 page |
| CFTR | P13569 | 30+ InterPro entries → 53 ProteinDomain objects | 1 page |
| EGFR | P00533 | 30+ InterPro entries → 57 ProteinDomain objects | 1 page |
| Trp53 (mouse) | P02340 | 22 InterPro entries → 25 ProteinDomain objects | 1 page |

All tested proteins fit within a single page at page_size=200 (`next = null`). The pagination 
code path (`while (nextUrl)`) is implemented to handle any protein with >200 InterPro entries.

**Note on domain count vs entry count:** The InterPro API returns `N` entries; each entry may have 
multiple location fragments (e.g., discontinuous domains). Each fragment becomes a separate 
`ProteinDomain` object per spec — no merging or truncation. This explains why domain count 
(27 for TP53) exceeds InterPro entry count (22).

### Architecture Decision (Final)

**Source selected: InterPro REST API, accessed via ProteinIdentifierResolver (UniProt mapping).**

Two new services built:
1. `ProteinIdentifierResolver` — RefSeq→UniProt mapping via UniProt ID Mapping API  
   Cache namespace: `protein-id-map:{refseqAccession}` | Rate limit: 300ms | TTL: 24h
2. `ProteinDomainService` — InterPro REST API client  
   Cache namespace: `proteindomain:{refseqAccession}` | Rate limit: 400ms | TTL: 24h

Both services are completely independent from each other and from the NCBI client.
