---
name: Protein ESummary direct accession
description: NCBI ESummary db=protein accepts accession.version strings directly — no UID resolution step needed.
---

**Rule:** `esummary.fcgi?db=protein&id=NP_000537.3,NP_001394199.1,...` works directly. Returns UIDs and full summary entries in one call. No prior ESearch or ELink step is required.

**Why:** Confirmed live (NP_000537.3 → UID 120407068, slen 393, correct accessionversion returned). This avoids a 2-call round-trip (ESearch→ESummary) and keeps the protein batch to a single NCBI call regardless of gene size.

**How to apply:** In fetchProteinSummaries, join all accession versions as the `id` param, call ESummary once, and key the result map by `accessionversion` field.

**GenPept field locations (confirmed NP_000537.3):**
- `slen` in ESummary → amino acid length
- `title` in ESummary → protein name with organism suffix (e.g. "... [Homo sapiens]")
- FEATURES > Protein > `/product=` → clean protein name (no organism suffix)
- FEATURES > Protein > `/calculated_mol_wt=43522` → optional integer, Daltons
- LOCUS line second token before " aa" → length (backup to slen)
