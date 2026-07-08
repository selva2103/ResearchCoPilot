---
name: Resolver gene-vs-disease ranking
description: How the biological resolver prioritises Gene over Disease for gene-symbol queries, and why.
---

## Rule
The resolver (`lib/resolver/index.ts`) runs a sequential pipeline: Accession → Gene → Organism → Disease. Gene resolution was historically gated on `GENE_SYMBOL_RE.test(q)` which requires all-uppercase, causing lowercase gene symbols (e.g. "tp53") to skip the gene step entirely and land in Disease via MedGen.

Fix (Step 2): compute `geneQuery = GENE_SYMBOL_RE.test(q) ? q : GENE_SYMBOL_RE.test(q.toUpperCase()) ? q.toUpperCase() : null` before calling `resolveGene`. This makes gene resolution case-insensitive for single-token alphanumeric queries.

Fix (Step 4 gate): if `\d/.test(q) && GENE_SYMBOL_RE.test(q.toUpperCase()) && !DISEASE_QUALIFIER_RE.test(q)`, return `unknownResolution` instead of calling `resolveDisease`. This prevents MedGen polymorphism/variant entries from winning when the gene resolver fails transiently for a numeric gene symbol.

**Why the digit gate:** pure-alpha single-token disease names like "cancer" or "tuberculosis" have no digits, so they bypass the gate and reach disease resolution. Gene symbols that overlap with disease nomenclature (e.g. "TP53 polymorphism") have spaces, so `GENE_SYMBOL_RE.test(q.toUpperCase())` is false and the gate does not apply.

**DISEASE_QUALIFIER_RE** lists disease-specific qualifier words. When a gene-symbol-like query contains one (e.g. "TP53 mutation"), it intentionally routes to disease — but because the query contains a space, the GENE_SYMBOL_RE gate doesn't apply anyway.

**How to apply:** When modifying the resolver pipeline order or adding new disease sources, preserve the gate logic. Any new disease resolver must be placed AFTER the gate check. Do not remove the digit requirement — it is intentional to let disease nouns pass through.
