/**
 * types/research-context.ts — Phase 5.4B
 *
 * Generic ResearchContext<T> interface and its protein-specific instantiation
 * ProteinResearchContext. Per Phase 5.4B scope, ResearchContext<T> is defined
 * generically to allow reuse by Variant Explorer (5.5+) and other future modules,
 * but it is intentionally NOT retrofitted onto the existing Gene Explorer or
 * Transcript Explorer in this phase — those modules are stable and their shapes
 * are unchanged.
 *
 * DOMAIN/UI SEPARATION: This file must remain a pure domain model with no
 * HTML, JSX, Markdown, color codes, icon names, or badge-rendering strings.
 * All presentation decisions belong to the consuming UI component.
 *
 * VERSION AWARENESS RULE: Every identifier used to key, cache, or identify
 * a ProteinResearchContext must use the full accession version (e.g. NP_000537.3),
 * never the bare accession (NP_000537). This is enforced at the cache-key level
 * in lib/protein/index.ts and at the route level.
 */

import type { ProteinRecord } from "./protein-record";

// ─── Generic ResearchContext<T> ────────────────────────────────────────────────

/**
 * Generic research-context envelope, parameterised over the domain record type T.
 *
 * Currently instantiated only for Protein (ProteinResearchContext below).
 * NOT applied to GeneRecord or TranscriptRecord in this phase — the retrofit
 * is explicitly out of scope per the Phase 5.4B specification.
 *
 * Fields are the minimal common shape that makes sense across all future
 * biological record types. Type-specific additions belong on the concrete
 * instantiation (e.g. `canonicalExplanation` on ProteinResearchContext).
 */
export interface ResearchContext<T> {
  /**
   * The underlying domain record this context was derived from.
   * The subject is read-only — derivation must never mutate it.
   */
  readonly subject: T;

  /**
   * Free-text biological summary, extracted and formatted from the upstream
   * data source (no LLM inference). Null when the source data is too sparse
   * to produce a meaningful, grounded sentence.
   *
   * `text`   — the summary sentence(s).
   * `source` — the specific upstream field(s) used (e.g. "RefSeq GenPept COMMENT").
   */
  readonly summary: { readonly text: string; readonly source: string } | null;

  /**
   * Short biological role labels extracted from structured annotation fields
   * (e.g. GenPept KEYWORDS). Each chip names its evidence source.
   *
   * Empty array when no reliable role annotation is present — never guessed.
   * The `source` field on each chip names the GenPept field it came from.
   */
  readonly roleChips: ReadonlyArray<{ readonly label: string; readonly source: string }>;

  /**
   * Researcher-facing translation of Phase R's numeric resolver confidence.
   * Derived from NormalizedQuery.confidence (and NormalizedQuery.ambiguous)
   * via mapResolutionConfidence() — read-only translation, never a new score.
   *
   * "high"      — NormalizedQuery.confidence ≥ 0.90 and not ambiguous
   * "medium"    — NormalizedQuery.confidence ≥ 0.70 and not ambiguous
   * "low"       — NormalizedQuery.confidence ≥ 0.50 and not ambiguous
   * "ambiguous" — NormalizedQuery.ambiguous === true, or confidence < 0.50
   */
  readonly resolutionConfidence: "high" | "medium" | "low" | "ambiguous";

  /**
   * How well-annotated the underlying data source record is, derived from
   * structural completeness signals in the GenPept response — independent of
   * resolution confidence.
   *
   * "well-annotated" — ≥ 3 of 5 GenPept annotation signals present (COMMENT,
   *                    DEFINITION, KEYWORDS, proteinName, molecularWeight),
   *                    with COMMENT required.
   * "limited"        — 2 signals present, or ≥ 3 but COMMENT absent.
   * "unavailable"    — 0–1 signals present.
   */
  readonly annotationConfidence: "well-annotated" | "limited" | "unavailable";

  /**
   * Structured statement about the gene's disease significance, derived
   * exclusively from data already present on the GeneRecord (OMIM ID +
   * NCBI Gene curated summary). Null when omimId is absent, summary is
   * absent, or the available text is too generic to form a specific claim.
   */
  readonly biologicalImportance: {
    readonly text: string;
    readonly source: string;
  } | null;

  /**
   * Key→value map documenting the derivation chain for this research context.
   * For proteins: Gene → Transcript → Protein → Species.
   * No UI-specific formatting — keys and values are plain strings.
   */
  readonly relationships: Readonly<Record<string, string>>;

  /**
   * Structural placeholder for future PubMed-sourced research notes.
   * Always null in Phase 5.4B — the field exists so future phases can
   * populate it without a schema change. Never serialised as an empty array.
   */
  readonly researchNotesPlaceholder: null;
}

// ─── ProteinResearchContext ────────────────────────────────────────────────────

/**
 * Research context for a single RefSeq protein isoform.
 * Extends ResearchContext<ProteinRecord> with a protein-specific explanation
 * of canonical/isoform status.
 *
 * Derived exclusively from:
 *   - ProteinRecord (GenPept detail) → summary, roleChips, annotationConfidence,
 *                                      canonicalExplanation (partial), relationships
 *   - TranscriptRecord              → canonicalExplanation, relationships
 *   - GeneRecord                    → biologicalImportance, relationships
 *   - NormalizedQuery               → resolutionConfidence (read-only translation)
 *
 * Immutable after creation — see IMMUTABILITY RULE in Phase 5.4B spec.
 * No field may reference UniProt, GO, AlphaFold, PDB, or any external
 * API not already used in Phases 5.2–5.4A.
 */
export interface ProteinResearchContext extends ResearchContext<ProteinRecord> {
  /**
   * Plain-language sentence explaining the canonical/isoform status of this protein.
   *
   * - isCanonical === true:  states this is the canonical isoform via MANE Select.
   * - isCanonical === false: states this is an alternative isoform, naming the
   *                          canonical MANE Select transcript accession if known.
   * - isCanonical === null:  states canonical designation does not apply
   *                          (non-human gene; MANE Select is human-only).
   *
   * Never implies canonical/non-canonical status for non-human genes where
   * the MANE Select system does not apply (the null-not-false rule from Phase R
   * and Phase 5.3A is preserved here).
   */
  readonly canonicalExplanation: string;
}
