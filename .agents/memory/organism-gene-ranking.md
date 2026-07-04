---
name: Organism-aware gene ranking
description: How species-qualified gene queries (e.g. "mouse CD4") are resolved correctly via organism prefix detection
---

## Rule
Species-qualified gene queries ("mouse CD4", "rat EGFR", "zebrafish Sox2") require an organism-prefix pre-step in the resolver BEFORE synonym normalization. The pre-step must return `null` when no gene is found for that organism — NOT fall through to a broad cross-organism search, which would silently return the wrong species' gene.

**Why:** GENE_SYMBOL_RE in resolver/gene.ts is uppercase-only and single-word — "mouse CD4" fails it (has a space). Without the pre-step, the query either resolves to Organism type (gates out the gene module entirely) or routes to free-text gene search (returns garbage). Also, non-human gene symbols are often mixed-case (Trp53, Sox2) — the pre-step accepts these.

**How to apply:**
- Pre-step in `lib/resolver/index.ts` `_resolveQuery()`, before synonym normalization
- Organism prefix table lives in `lib/resolver/organism-prefix.ts` (9 organisms; see ORGANISM_PREFIXES)
- ESearch field tag: `{SYMBOL}[sym] AND {taxId}[Taxonomy ID]` — verified 2026-07-03 to return correct gene (e.g. mouse Cd4 = Gene ID 12504, rat Egfr = 24329, zebrafish sox2 = 378723)
- On miss (taxId-filtered ESearch returns 0 results): return `null` from `resolveGene()` — this causes the pre-step to fall through to normal resolver pipeline
- Do NOT fall back to broad `{SYMBOL}[sym]` inside the organism-prefix path (code review caught this bug)
- Three new fields on QueryResolution: `detectedOrganismTaxId`, `detectedOrganismName`, `strippedGeneQuery`
- Downstream modules must use `resolution.detectedOrganismTaxId`, not re-parse the query (FIX 6 contract)
- Unqualified queries (TP53, EGFR, CD4): no prefix detected → `detectOrganismPrefix()` returns null → pipeline unchanged
