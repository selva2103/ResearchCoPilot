---
name: ClinVar Variant Foundation
description: Phase 5.5A implementation details — ClinVar API quirks, architectural discrepancies, and variant module design decisions.
---

# ClinVar Variant Foundation (Phase 5.5A)

## API Quirks (confirmed 2026-07-11)

**Gene-level retrieval:** `{geneId}[Gene ID]` ESearch works. TP53=3991, BRCA1=15986.

**Server-side sorting:** `sort=clinical_significance` = same as default (no-op). Only `sort=relevance` produces a distinct ordering. Never label variants as "sorted by clinical significance."

**Server-side filtering:** `"pathogenic"[clinical_significance]` and `"single nucleotide variant"[Variant Type]` both work as ESearch filters.

**ESummary structure:**
- `uid` = numeric Variation ID (stable key)
- `accession` = VCV format (e.g., VCV004856711)
- `variation_set[0].variation_name` = representative HGVS string
- `molecular_consequence_list` = consequence type strings
- `protein_change` = comma-separated multi-transcript changes (no transcript accessions)
- `genes[0].{geneid, symbol}` = gene reference
- `germline_classification` = clinical data (5.5B scope only)

**EFetch VCV:** `rettype=vcv` returns `<ClinVarResult-Set><set/></ClinVarResult-Set>` — empty, unusable. No per-variant EFetch via EUtils.

**rsID lookup:** `{digits}[RS]` works (no "rs" prefix in ESearch term).
**Variation ID lookup:** `{id}[Variation ID]` works.
**VCV accession:** strip "VCV" prefix + parse integer to get numeric ID, then use `[Variation ID]`.

**NCBI ceiling:** retstart + retmax ≤ 9999. hitUpstreamLimit fires at offset ≥ 9999.

## Architectural Discrepancies

**D1 — Single consequence only:** ESummary provides one representative consequence via variation_name. `transcriptConsequences` has 0-1 entries in 5.5A. Full multi-transcript breakdown requires ClinVar VCV XML (unavailable via EFetch).

**D2 — genomicHgvs = null:** ESummary provides SPDI (canonical_spdi), not genomic HGVS. Conversion prohibited as heuristic.

## Implementation Pattern

```
lib/variant/
  search.ts  — NCBI ESearch/ESummary wrappers
  parse.ts   — parseVariationName() + parseVariantRecord()
  index.ts   — searchVariants(), lookupVariantByRsId(), lookupVariantByVariationId()
app/api/variant/list/route.ts  — POST endpoint
components/VariantExplorerSection.tsx  — lazy-load UI, filters, server-side pagination
```

**Cache keys:** `variant:list:{geneId}:{offset}:{pageSize}:{filter}:{sort}` and `variant:detail:rs:{rsDigits}` and `variant:detail:{variationId}`.

**Non-human guard:** taxonomyId ≠ "9606" → return NON_HUMAN_ORGANISM error, never call ClinVar.

**Resolver integration:** `classifyVariantIdentifier()` in lib/resolver/accession.ts runs as Step 1a (before protein accession Step 1b). Sets NormalizedQuery.variant slot; all other slots null. Confidence = 0.97.

## What Belongs to 5.5B (do not implement in 5.5A)

- germline_classification.description / review_status
- RCV/SCV submission data
- Conflict handling, multi-submitter analysis
- Population frequency (gnomAD) — out of scope entirely

**Why:** 5.5A = variant identity (accessions, type, representative HGVS). 5.5B = clinical evidence (assertions, review status, conflicts).
