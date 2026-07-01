---
name: Disease resolver normalizedQuery strategy
description: Why the disease resolver uses the original query (not MedGen top result title) as normalizedQuery for partial matches.
---

## normalizedQuery for partial disease matches

**Rule:** When the MedGen disease resolver finds a partial match (no exact title match in top 5 results), set `normalizedQuery = originalQuery` (not the subtype title from the top result).

**Why:** MedGen's relevance ranking surfaces specific subtypes before canonical concepts for broad terms. "Tuberculosis" → top result is "Positive Mycobacterium tuberculosis sputum culture". Using that as `normalizedQuery` would be actively misleading — the user typed "Tuberculosis" and we'd be showing them a completely different string as the canonical term.

The original query IS the canonical intended term; we just can't confirm it uniquely (hence MEDIUM confidence). The CUI is still included as `primaryIdentifier` to prove domain recognition.

**How to apply:** Only use the MedGen result title as `normalizedQuery` when it exactly matches the query (case-insensitive). For partial matches, use `q` (the query after synonym expansion).
