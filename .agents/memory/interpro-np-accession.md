---
name: InterPro NP_ accession gap
description: InterPro REST API does not accept RefSeq NP_/XP_ accessions; requires UniProt ID Mapping API bridge; async job pattern; multi-mapping rule.
---

# InterPro NP_ Accession Gap + UniProt Mapping

**Rule:** InterPro's `/entry/all/protein/uniprot/{accession}/` endpoint rejects RefSeq NP_/XP_ accessions with a server error. Must use the UniProt ID Mapping API first.

**Why:** InterPro only indexes UniProt accessions. RefSeq NP_ → UniProt mapping is NOT reliably embedded in GenPept notes (BRCA1 NP_009228.2 has no Swiss-Prot note despite P38398 existing in Swiss-Prot).

**How to apply:** Use `ProteinIdentifierResolver` (`lib/protein/identifier-resolver.ts`) as the single canonical mapping layer. Future phases (5.8 AlphaFold, 5.9 STRING) MUST go through this resolver — never re-implement independently.

## UniProt ID Mapping API Pattern

- URL: `POST https://rest.uniprot.org/idmapping/run` with `from=RefSeq_Protein`, `to=UniProtKB`
- Async job: submit → poll `/idmapping/status/{jobId}` → fetch `/idmapping/results/{jobId}?format=json`
- Max poll attempts: 12 × 2s = 24s budget. Timeout = transient failure (NOT cached as "unresolved").

## Multi-mapping Rule (deterministic)

A RefSeq accession maps to 1–4 UniProt entries (Swiss-Prot canonical + TrEMBL fragments).

| Swiss-Prot count | Resolution |
|---|---|
| Exactly 1 | `resolved` → use that accession |
| 2+ | `ambiguous` → do not auto-pick |
| 0 | `unresolved` → no Swiss-Prot curated |

Confirmed 5/5 regression proteins (TP53, BRCA1, CFTR, EGFR, mouse Trp53): each had exactly 1 Swiss-Prot entry among 1–4 total mappings.

## ProteinIdentifierResolver Status

Provisional — built for reuse but NOT in Frozen Architecture as of Phase 5.7A. Freeze eligibility assessed after Phase 5.8 validates it as second consumer.
Cache namespace: `protein-id-map:{refseqAccession}` | TTL: 24h | Rate: 300ms | Host: rest.uniprot.org
