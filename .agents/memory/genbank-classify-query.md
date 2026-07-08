---
name: Genbank classifyQuery case sensitivity
description: classifyQuery() in genbank/search.ts requires care when handling lowercase gene symbols vs organism names.
---

## Rule
`classifyQuery()` uses a two-stage gene-symbol check:
1. `GENE_SYMBOL_RE.test(trimmed)` — matches all-uppercase symbols directly ("TP53", "EGFR").
2. Fallback for lowercase/mixed-case: only classifies as gene-symbol if the lowercased form has at least one digit AND matches GENE_SYMBOL_RE when uppercased ("tp53" ✓, "brca1" ✓, "Trp53" ✓).

Pure-alphabetic lowercase strings ("mouse", "arabidopsis", "egfr") are intentionally left as "organism" — no digit means no auto-upgrade to gene-symbol.

**Why:** GENE_SYMBOL_RE originally required all-uppercase to prevent organism names from being misrouted. Users type gene symbols in lowercase (e.g. "tp53"), which broke sequence lookup. The digit-gate allows lowercase gene symbol detection without misrouting common organism common-names (which rarely contain digits).

**How to apply:** When changing classifyQuery or the GENE_SYMBOL_RE guard, preserve the digit requirement for the lowercase case. If you need pure-alpha lowercase like "egfr" to resolve as gene-symbol, a separate explicit allow-list or a higher-level resolver normalization step is safer than removing the digit gate.

Also: dispatch in `genbank/index.ts` uppercases before calling `resolveGeneSymbol()` so NCBI Gene ESearch gets "TP53[Gene Name]" (1 hit) vs "tp53[Gene Name]" (2876 hits).
