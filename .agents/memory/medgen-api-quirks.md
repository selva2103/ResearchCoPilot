---
name: MedGen ESummary API quirks
description: Observed live-API shape differences from NCBI MedGen ESummary that cause silent resolver failures if not handled.
---

## MedGen ESummary shape (live API, observed July 2026)

### semantictype field
- **Expected (from docs):** plain string, e.g. `"Disease or Syndrome"`
- **Actual:** object `{ "value": "Disease or Syndrome" }` or empty object `{}`
- **Fix:** use a helper `getSemanticTypeString()` that handles both `string` and `{ value: string }` forms. Treat empty `{}` as permissively valid (MedGen is disease-focused; non-disease concepts are rare).

### definition field
- **Actual:** object `{ "value": "..." }` or `{}` — NOT a plain string.
- **Not yet parsed in disease.ts** (not needed for current use).

### Result ordering
- MedGen ESearch for broad disease terms (e.g. "Tuberculosis", "Leukemia", "Down syndrome") returns **specific subtypes first**, not the canonical concept.
- The canonical "Tuberculosis" CUI (C0041303) is NOT in the top 5 results for the query "Tuberculosis".
- **Fix:** for partial matches, use the ORIGINAL QUERY as `normalizedQuery`, not the subtype title. Surfacing a subtype title as `normalizedQuery` is actively misleading.
- `[TITL]` field qualifier does not help — subtypes still rank before canonical concepts.

**Why:** NCBI MedGen ESearch ranks by relevance, not by concept breadth. Broad disease names match many specific subtypes that score higher.

**How to apply:** Any resolver that uses MedGen ESummary must handle `semantictype` as `{ value?: string } | string | {}`, never assume plain string. Always check retmax ≥ 5 and prefer exact title match before falling back.
