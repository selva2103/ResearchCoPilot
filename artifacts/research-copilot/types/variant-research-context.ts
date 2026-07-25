/**
 * types/variant-research-context.ts — VariantResearchContext data model (Phase 5.5B-2)
 *
 * DERIVATION CONTRACT:
 *   Pure structured extraction from already-fetched data — no LLM, no new NCBI calls.
 *   - clinicalSummary:  derived from ClinicalEvidence (condition names + aggregate classifications)
 *   - conflictSummary:  derived from ClinicalEvidence.interpretations[*].submissions
 *   - transcriptContext: reused from VariantRecord.transcriptConsequences (zero transformation)
 *   - relationships:    from VariantRecord fields (geneId, organism, first transcript/protein)
 *   - provenance:       documents which source fields were used to populate each section
 *
 * SCOPE RULES (Phase 5.5B-2):
 *   - No PubMed citation mining
 *   - No pathway / GO data
 *   - No population frequency / gnomAD
 *   - No condition-synonym grouping or MedGen navigation UI
 *   - No LLM-generated text anywhere
 *   - No new API calls — all data already available in cache from prior fetches
 *
 * FIELD NAMING:
 *   `clinicalSummary` (not `summary`) — domain-scoped to avoid semantic collision with
 *   future VariantFunctionalContext.summary or VariantStructuralContext.summary.
 *
 * CONFLICT RULE:
 *   conflictSummary MUST NOT declare a winner or imply one interpretation is more correct.
 *   It MAY only describe the distribution of classifications (e.g. "3 Pathogenic, 1 VUS").
 *   ConditionInterpretation.aggregateClassification remains the only authoritative verdict,
 *   and it is shown separately (already rendered by ConditionInterpretationBlock).
 *
 * IMMUTABILITY: This interface is read-only throughout. No consuming component may mutate it.
 * PUBLIC CONTRACT: Do not rename or reshape these fields — downstream phases will read them.
 */

import type { VariantTranscriptConsequence } from "./variant-record";

export interface VariantResearchContext {
  /** ClinVar numeric Variation ID — links back to ClinicalEvidence and VariantRecord. */
  readonly clinvarVariationId: string;

  /**
   * Structured clinical summary derived from ClinicalEvidence.
   * One sentence describing the conditions and ClinVar's aggregate classifications.
   * Null when no interpretations exist or data is too sparse for a grounded sentence.
   * Source: ClinicalEvidence.interpretations (condition names + aggregate classifications).
   * Never LLM-generated; never inferred.
   */
  readonly clinicalSummary: { readonly text: string; readonly source: string } | null;

  /**
   * Distribution summary of submission-level classifications across all interpretations.
   * Shows the spread (e.g. "3 Pathogenic, 1 Uncertain significance") without declaring a winner.
   * Null when there is only one submission across all conditions (no conflict possible),
   * or when there are no submissions at all.
   *
   * CRITICAL RULE: this field MUST NOT imply any interpretation is more correct than another.
   * The authoritative classification is always ConditionInterpretation.aggregateClassification.
   * Source: ClinicalEvidence.interpretations[*].submissions[*].significance.
   */
  readonly conflictSummary: { readonly text: string; readonly source: string } | null;

  /**
   * Transcript-level consequences for this variant.
   * Reused verbatim from VariantRecord.transcriptConsequences — zero transformation.
   * May be empty (0–1 entries per Phase 5.5A limitation).
   */
  readonly transcriptContext: readonly VariantTranscriptConsequence[];

  /**
   * Biological entity relationship chain for this variant.
   * Derived from VariantRecord fields. All values are as-provided — never fabricated.
   */
  readonly relationships: {
    readonly geneId: string;
    readonly geneSymbol: string;
    readonly transcriptAccession: string | null;
    readonly proteinAccession: string | null;
    readonly organism: string;
  };

  /**
   * Provenance trail — what source data was used to populate each field.
   * Provides transparency for researchers about where each piece of data came from.
   * One entry per populated section.
   */
  readonly provenance: readonly { readonly source: string; readonly field: string }[];
}
