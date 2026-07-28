---
name: GO parser large XML strategy
description: Gene EFetch XML (db=gene, rettype=xml) can be 30MB+ for well-studied genes; general-purpose block-finding parsers silently return empty. Use a string-slice + boundary approach.
---

## Rule
Never use recursive or iterative `findAllBlocks` on the full Gene EFetch XML. The file can be 34MB with 17,000+ nested `Gene-commentary` elements. Any O(n²) scanning silently fails inside a Next.js server route.

## Working Strategy (Phase 5.6A parser)
1. Find the `GeneOntology` heading string position in the full XML.
2. Find the *next* `<Gene-commentary_heading>` to bound the section end.
3. Extract a section slice (~100–500KB, not 34MB).
4. Within the section slice, locate the three aspect label positions (Function / Process / Component) and split into per-aspect slices.
5. Apply a targeted regex on each small aspect slice — never on the full document.

**Why:** TP53 Gene EFetch XML is 34,610,443 characters with ~17,781 Gene-commentary elements. Any parse strategy that scans the full string multiple times (e.g. `lastIndexOf` in a loop, recursive descent) either times out silently or produces `[]`.

**How to apply:** Any future parser that needs to extract a named section from Gene EFetch XML should first narrow to the section slice using heading-boundary detection before running regex or structural parsing.

## GO XML Section Structure (confirmed TP53, BRCA1, CFTR, Trp53 mouse)
```
<Gene-commentary_heading>GeneOntology</Gene-commentary_heading>
  → <Gene-commentary_label>Function|Process|Component</Gene-commentary_label>
    → per entry:
        <Object-id_id>{numericId}</Object-id_id>
        <Other-source_anchor>{term}</Other-source_anchor>
        <Other-source_post-text>evidence: {CODE}</Other-source_post-text>
```
GO numeric IDs are zero-padded to 7 digits: `71889` → `GO:0071889`.
