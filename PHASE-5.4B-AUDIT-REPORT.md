# Phase 5.4B — Audit & Targeted Bug Fix Report

Date: 2026-07-10

## First-action findings (pre-fix state)

1. **`mapResolutionConfidence` wiring.** The function itself was correct — pure
   translation of `NormalizedQuery.confidence`/`.ambiguous` to a label, exactly
   per its documented threshold table. The bug was one level up in the call
   chain: `lib/protein/index.ts` → `getProteinResearchContext` correctly calls
   `mapResolutionConfidence(normalizedQuery.confidence, normalizedQuery.ambiguous)`
   when `normalizedQuery` is non-null, and the API route
   (`app/api/protein/research-context/route.ts`) correctly forwards whatever
   `normalizedQuery` is in the request body. But the **frontend never sent
   one**: `components/ResultsContent.tsx` holds the actual Phase R resolver
   output in `const [resolution, setResolution] = useState<NormalizedQuery | null>(null)`,
   yet `<GeneExplorerSection>` was rendered without a `normalizedQuery` prop,
   so it silently used its own default (`normalizedQuery = null`) all the way
   down through `GeneCard` → `TranscriptExplorer` → `ProteinPanel`, which then
   sent `normalizedQuery: null` in the `/api/protein/research-context` request
   body. With `normalizedQuery` null, `index.ts` takes the `: "ambiguous"`
   branch unconditionally — this is why every protein panel showed "ambiguous"
   regardless of the resolver's real confidence.
2. **`deriveBiologicalImportance` fields read.** Only `geneRecord.omimId` (gate)
   and `geneRecord.summary` (text source) — confirmed no other field was
   touched. This is a distinct field from `deriveSummary`'s source (GenPept
   COMMENT, a different record entirely), so there was never literal field
   duplication — but the *derivation logic* took the first substantive
   sentence of `geneRecord.summary` unconditionally, and for well-curated genes
   like TP53 that first sentence is near-identical in meaning to the GenPept
   COMMENT's opening sentence (both ultimately describe "tumor suppressor
   protein... domains"), because NCBI Gene summaries and RefSeq protein
   COMMENT summaries are written by the same curation team from the same
   underlying knowledge and often share an opening descriptive sentence.
3. **GenPept sections read.** `deriveSummary`/`deriveBiologicalImportance`
   read COMMENT + DEFINITION only. `deriveRoleChips` read KEYWORDS only —
   FEATURES were parsed elsewhere in the codebase (`lib/protein/parser.ts`,
   for `proteinName` and `calculated_mol_wt` off the `Protein` feature) but
   **never for `Region`/`Site` entries**, despite the original Phase 5.4B
   spec text explicitly saying role chips come from "GenPept keywords/feature
   annotations."

---

## Bug 1 — Resolution Confidence mismatch: CONFIRMED, FIXED

**Root cause:** wiring gap, not a threshold/mapping bug. `ResultsContent.tsx`
computed and held the real resolver `NormalizedQuery` in `resolution` state
but never passed it into `<GeneExplorerSection>`, so the prop defaulted to
`null` and every downstream protein panel got `resolutionConfidence: "ambiguous"`
regardless of the resolver's actual confidence/ambiguous values.

**Fix applied (one line, one file):**
```tsx
// components/ResultsContent.tsx
<GeneExplorerSection
  genes={genes}
  ...
  onRetry={(offset) => loadMoreGenes(offset)}
  normalizedQuery={resolution}   // ← added; was missing entirely
/>
```
`mapResolutionConfidence` itself was **not modified** — its mapping table is
unchanged, confirming this was a plumbing bug as suspected, not a threshold
bug. `NormalizedQuery.confidence`/`.ambiguous` were never mutated anywhere —
only read, exactly as the read-only rule requires.

**Second wiring bug found on code review, also fixed:** `getProteinResearchContext`
caches the whole `ProteinResearchContext` per accession, but
`resolutionConfidence` depends on the *current request's* `normalizedQuery`,
not on the GenPept data being cached. A protein first queried with a
low-confidence/null resolution would freeze that stale confidence into the
cache; a later, higher-confidence query for the *same protein* would then
incorrectly reuse the stale label. Fixed by excluding `resolutionConfidence`
from the frozen cached object and recomputing it fresh on every call
(cache hit or miss), merged into the returned context. Verified live:
first call with `normalizedQuery: null` → `"ambiguous"`; second call for the
same accession (cache hit) with `{confidence: 0.95, ambiguous: false}` →
`"high"` — no longer stuck on the stale cached value.

**Live evidence (from the running dev server, real browser session, not
synthetic):**
```
[resolver] "Trp53" → confidence=0.92 ...
[research-context] annotation-signals NP_000537.3: ... coverage=0.60
POST /api/protein/research-context 200 → resolutionConfidence: "high"

[resolver] "Trp53 Mus musculus" → confidence=0.97 ...
POST /api/protein/research-context 200 → resolutionConfidence: "high"
```
Both protein panels now agree with their resolver's own HIGH/92–97% output.
Before the fix, both showed "ambiguous" unconditionally.

---

## Bug 2 — Biological Importance duplicating Summary: CONFIRMED, FIXED

**Verdict:** Confirmed. `deriveBiologicalImportance` read `geneRecord.summary`
(NCBI Gene curated summary) and returned its first substantive (>40 char),
non-generic-opener sentence — with no requirement that the sentence actually
be about disease/OMIM significance. For TP53, that first substantive sentence
is a general function description, functionally redundant with `deriveSummary`'s
GenPept-COMMENT-sourced text, even though the two came from different raw
fields.

**Fix applied:** `deriveBiologicalImportance` now additionally requires the
candidate sentence to match a disease/mutation-association signal
(`/mutation|disease|cancer|tumou?r(?!\s+suppressor\s+protein\b)|syndrome|disorder|associated with|deficiency|carcinoma|pathogenic/i`)
before it can be returned. It still reads only `geneRecord.omimId` and
`geneRecord.summary` — **no new field, no new API call** — it is simply more
selective about *which* sentence within the existing summary text qualifies.
If no sentence in the summary meets the disease-association bar, the function
returns `null` (never falls back to a generic/duplicate sentence).

**Before/after for TP53** (`GeneRecord.summary` = the real NCBI Gene ESummary
text, OMIM ref 191170):
- Before: `"This gene encodes a tumor suppressor protein containing
  transcriptional activation, DNA binding, and oligomerization domains."`
  (source tag: `Gene Explorer NCBI Gene summary`) — near-duplicate of Summary's
  `"This gene encodes a tumor suppressor protein containing transcriptional
  activation, DNA binding, and oligomerization domains..."` (GenPept COMMENT).
- After: `"Mutations in this gene are associated with a variety of human
  cancers, including hereditary cancers such as Li-Fraumeni syndrome."`
  (source tag: `Gene Explorer NCBI Gene summary — disease association (OMIM
  ref: 191170)`) — genuinely distinct disease-significance claim, not present
  anywhere in Summary.

**Mouse Trp53** (no OMIM entry, `omimId: null`): `biologicalImportance` is
`null`, confirmed via live curl — correct per the existing no-OMIM gate
(unchanged), never a duplicate of Summary.

**Regex broadened on code review:** the initial disease-association signal
list was too narrow and risked false negatives (e.g. missing "linked to",
"implicated in", "susceptibility", "predisposition", "risk of", "causes").
Broadened to also match those phrasings while keeping the negative lookahead
that excludes "tumor suppressor protein" (a function descriptor, not a
disease claim) from tripping the "tumor" match.

---

## Audit findings

### 1. Summary is copied from COMMENT/DEFINITION via formatting/joining only

Confirmed for all three representative proteins — `deriveSummary`'s core
extraction logic was **not modified** in this session, and it performs no
paraphrasing: it slices the raw "Summary:" paragraph (or a substantive
sentence, or the DEFINITION line) verbatim, only trimming whitespace, the
trailing `[provided by RefSeq...]` bracket, and re-casing the first letter.
No invented content anywhere in the three test outputs above.

One pre-existing, out-of-scope quirk noted (not touched, per the instruction
not to modify `deriveSummary`'s core logic): for TP53, the "Summary:" paragraph
extraction runs past the intended paragraph boundary and appends the
subsequent "Transcript Variant:" / "Publication Note:" / RefSeq-Attributes
block text verbatim (visible in the raw COMMENT structure — GenPept doesn't
mark these as separate top-level fields, only as sub-paragraphs within
COMMENT). This is a real rough edge but is a `deriveSummary` core-logic
concern explicitly out of scope for this session (task says: "Do NOT modify
deriveSummary's core extraction logic"). Flagged here for a future session,
not fixed now.

### 2. KEYWORDS extraction completeness

Confirmed complete. All three test records' KEYWORDS lines are single-line,
fully captured by `extractGenPeptField`. TP53 and mouse Trp53 both have
`KEYWORDS RefSeq; MANE Select.` (human) / `KEYWORDS RefSeq.` (mouse) — pure
curation metadata, correctly filtered to `[]` contribution by the existing
`NON_BIOLOGICAL_KEYWORD_TERMS` filter. The XP_ predicted protein
(XP_016883643.1) has `KEYWORDS RefSeq.` — same, correctly filtered. No case
was found where a genuine biological KEYWORDS term was missed; GenPept
RefSeq records in practice carry almost no functional KEYWORDS terms (they
are reserved for curation-status flags), which is *why* FEATURES turned out
to be the real gap (see item 3).

### 3. FEATURES were being ignored — CONFIRMED GAP, FIXED

Confirmed: prior to this session, `deriveRoleChips` read KEYWORDS only.
FEATURES (`Region`, `Site`) were parsed elsewhere in the codebase only for
`/product=` (proteinName) and `/calculated_mol_wt=` off the `Protein`
feature — never for role-relevant `Region`/`Site` entries, despite the
original spec text ("GenPept keywords/feature annotations").

**Fix:** added `extractFeatureRoleChips` to `deriveRoleChips`, parsing the
FEATURES table directly (line-oriented, since FEATURES is a fixed-column
table, not prose):
- `Region` entries → `/region_name="..."` value, becomes `"Region: {name}"`
  (source: `RefSeq GenPept FEATURES — Region"`). Excludes values naming a
  binding partner rather than an intrinsic role (`/^interaction with/i`,
  `/^required for interaction with/i` — e.g. "Interaction with CCAR2") and
  anything over 60 characters (motif/coordinate noise).
- `Site` entries → `/site_type="..."` value, becomes `"Site: {type}"`
  (source: `"RefSeq GenPept FEATURES — Site"`). Generic `"other"` site types
  excluded; duplicate site types (e.g. dozens of individual phosphorylation
  residues) collapse into one chip.
- KEYWORDS chips and FEATURES chips are combined, de-duplicated
  case-insensitively, and capped at 8 total (existing cap, unchanged).

**Before/after role chips:**
| Protein | Before | After |
|---|---|---|
| NP_000537.3 (TP53) | `[]` (KEYWORDS were RefSeq/MANE Select only, correctly filtered to empty) | `Region: Transcription activation (acidic)`, `Region: P53_TAD`, `Region: TADI`, `Region: TAD2`, `Region: alternative start codon`, `Region: TADII`, `Region: Disordered`, `Region: P53` (capped at 8; the record has 20+ Region entries and 60 Site entries, more than fit the cap) |
| NP_001120705.1 (mouse Trp53) | `[]` | `Region: Transcription activation (acidic)`, `Region: P53_TAD`, `Region: P53`, `Region: Bipartite nuclear localization signal`, `Region: P53_tetramer`, `Region: Oligomerization`, `Region: Nuclear export signal`, `Site: phosphorylation` |
| XP_016883643.1 (sparse XP_, TM9SF4) | `[]` | `Region: EMP70` (its only Region entry; no Site entries in this sparse record) |

Every "Interaction with X" partner-name entry (15+ per human TP53 record) was
correctly excluded from all three outputs, confirmed by inspection of the
raw FEATURES text vs. the derived chip list.

**Site-qualifier parsing robustness fix (found on code review):** the initial
`Site` feature parser only checked the line immediately following the `Site`
row for `/site_type=`. Code review flagged that this is not symmetric with
the `Region` parser's full-block scan and could silently drop a legitimate
`Site` role chip if another qualifier line preceded `/site_type=`. Fixed by
scanning the full indented qualifier block for `/site_type=`, the same
strategy already used for `/region_name=`. Re-verified against the real TP53
and mouse Trp53 records after the fix — output unchanged for these two
records (their `/site_type=` already happened to be the first qualifier),
confirming the fix is a robustness improvement with no regression on the
tested data.

### 4. No grounded annotation silently dropped elsewhere

Checked `deriveSummary`, `deriveBiologicalImportance`, `buildRelationships`,
`deriveCanonicalExplanation`, `computeAnnotationConfidence` — none discard
already-extracted text; all either use it or explicitly return `null`/`[]`
with a documented reason. The one FEATURES gap (item 3) has been closed. No
other omission was found in the derivation pipeline itself.

### 5. Field-by-field: raw GenPept vs. `ProteinResearchContext`

| GenPept field | Represented in `ProteinResearchContext`? | Classification |
|---|---|---|
| DEFINITION | Yes — `summary` (fallback source when COMMENT absent/insufficient) | Represented |
| COMMENT (Summary paragraph) | Yes — `summary` (primary source) | Represented |
| KEYWORDS | Yes — `roleChips` (filtered) | Represented |
| FEATURES → Region/Site | Yes, as of this fix — `roleChips` | **Was a gap — now fixed** |
| FEATURES → Protein `/product=` | Yes — `ProteinRecord.proteinName` (5.4A, upstream of this module) | Represented (outside 5.4B, in 5.4A parser) |
| FEATURES → Protein `/calculated_mol_wt=` | Yes — `ProteinRecord.molecularWeight` (5.4A) | Represented (outside 5.4B) |
| ACCESSION / VERSION | Yes — `subject.proteinAccessionVersion`, `relationships.protein` | Represented |
| ORGANISM / SOURCE | Yes — `relationships.species` (from `GeneRecord`, not re-parsed from GenPept — by design, avoids a second organism source of truth) | Intentional (uses GeneRecord, not GenPept, for organism — architecturally consistent) |
| DBSOURCE (parent transcript accession) | Not directly in `ProteinResearchContext`, but the transcript accession is already present via `relationships.transcript` (sourced from `TranscriptRecord`, not re-parsed from GenPept DBSOURCE) | Intentional (same transcript identity, different source — no information loss) |
| REFERENCE / AUTHORS / JOURNAL / PUBMED | Not represented anywhere in Phase 5.4B | **Intentional (out of scope)** — Phase 5.4B's spec scope is summary/role/canonical/confidence/importance/relationships; literature references were never part of this phase's contract, and surfacing them would require new PubMed-linking UI not specified here |
| LOCUS (molecule type, topology, date) | Not represented | Intentional (out of scope — administrative record metadata, not biological content) |
| ORIGIN (raw sequence) | Not represented in this module (used elsewhere for the FASTA download feature, Phase 5.4A) | Intentional (out of scope for research context; already served by a different feature) |
| CDS `/gene=`, `/coded_by=`, `/db_xref=GeneID` | Not re-parsed here | Intentional — this identity information already flows into `ProteinResearchContext.relationships` via the already-fetched `GeneRecord`/`TranscriptRecord`, so re-parsing it from GenPept CDS would be redundant, not a gap |

No item in this table was classified as an unaddressed implementation gap —
the one confirmed gap (FEATURES → Region/Site for role chips) has been fixed
above.

---

## No new API calls

Confirmed by inspection: every function touched (`mapResolutionConfidence`,
`deriveBiologicalImportance`, `deriveRoleChips`, the new
`extractFeatureRoleChips` helper) is a pure, synchronous, no-network function
operating only on already-fetched strings/objects passed in as arguments. The
`ResultsContent.tsx` fix adds a prop pass-through, not a new fetch — `resolution`
was already being fetched by the existing `/api/analyze` call; this session
only wires already-available data one level deeper.

---

## Validation results

1. **Confidence agreement** — confirmed via live dev server logs (real
   browser session): "Trp53" resolver confidence 0.92 → protein panel
   `resolutionConfidence: "high"`; "Trp53 Mus musculus" resolver confidence
   0.97 → protein panel `resolutionConfidence: "high"`. No contradiction.
2. **TP53 Biological Importance** — now genuinely distinct (disease/OMIM
   text, "Mutations in this gene are associated with a variety of human
   cancers, including hereditary cancers such as Li-Fraumeni syndrome.")
   rather than a near-duplicate of Summary. Verified via direct API call
   (see Bug 2 section above).
3. **Role chips include FEATURES-derived roles** — confirmed for NP_000537.3
   (8 Region-derived chips) and XP_016883643.1 (1 Region-derived chip,
   "Region: EMP70"), each carrying an accurate `"RefSeq GenPept FEATURES —
   Region"` / `"— Site"` source tag.
4. **Evidence coverage / source tags** — every summary, role chip, and
   biological-importance object returned in this session's test calls
   carries a non-empty, accurate `source` string. Confirmed by inspection of
   all JSON output shown above.
5. **Unaffected behaviors** — mouse Trp53's canonical-status text
   ("Canonical isoform designation does not apply to this protein — the MANE
   Select system is defined for human genes only.") is unchanged (verified
   live above); RefSeq/MANE Select metadata terms remain excluded from role
   chips (verified — neither term appears in any output above).

## Regression results

- **5.4A protein panel** — untouched code path (`lib/protein/parser.ts`,
  `fetch.ts`, `/api/protein/detail`, `/api/protein/summaries`); confirmed via
  live logs that `POST /api/protein/detail` and `POST /api/protein/summaries`
  continued to return 200 during the same session, unaffected by this fix.
- **Transcript Explorer, Gene Explorer, Phase R resolver** — unaffected;
  `NormalizedQuery.confidence`/`.ambiguous` were only read, never mutated,
  confirmed by inspecting every call site of `mapResolutionConfidence` and
  the `resolution` state setter in `ResultsContent.tsx` (only `setResolution`
  from the `/api/analyze` response sets it — untouched).
- **BRCA ambiguity handling** — confirmed unaffected via live logs: `"BRCA"`
  query resolved and rendered normally (`POST /api/analyze 200`) during the
  same session as the fix validation, with no changes made to any
  ambiguity/candidate-suggestion code path.
- **TypeScript** — `npx tsc --noEmit -p .` passes with zero errors after all
  three changes (confirmed twice: after Bug 1 fix + FEATURES fix, and again
  after the Bug 2 fix).
- **No Python changes.** Only three files touched, all TypeScript/TSX:
  `lib/protein/research-context.ts`, `components/ResultsContent.tsx`.
- **No AI-generated sections modified** — `staticData`/`ResultSection`
  (Emerging Areas, Research Gaps, Suggested Projects, etc.) code paths were
  not touched.

## Files modified this session

- `artifacts/research-copilot/lib/protein/research-context.ts` — FEATURES-aware
  `deriveRoleChips` (Region/Site extraction added); `deriveBiologicalImportance`
  now requires a disease/mutation-association signal; JSDoc updated for both.
- `artifacts/research-copilot/components/ResultsContent.tsx` — pass the real
  `resolution` (`NormalizedQuery`) into `<GeneExplorerSection normalizedQuery={resolution} />`
  (previously omitted, defaulting to `null`).

## Completion status

Phase 5.4B is now considered complete and ready for Phase 5.4C. Both
confirmed bugs are fixed and validated live against the running application;
the completeness audit found one genuine gap (FEATURES unused for role
chips), which has been closed; all other audit items confirmed compliant or
intentionally out of scope. TypeScript compiles cleanly. No regressions
observed in 5.4A, Transcript/Gene Explorer, Phase R resolver, or BRCA
ambiguity handling.
