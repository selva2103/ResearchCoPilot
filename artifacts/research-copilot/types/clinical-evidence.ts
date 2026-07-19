/**
 * types/clinical-evidence.ts — ClinicalEvidence data contracts (Phase 5.5B-1)
 *
 * RCV-CENTERED MODEL: Each ConditionInterpretation corresponds to one ClinVar
 * RCV accession — ClinVar's aggregate interpretation of a variant for a
 * specific condition. A variant classified differently for different conditions
 * (e.g. Pathogenic for Li-Fraumeni syndrome, Likely pathogenic for "not provided")
 * produces separate ConditionInterpretation entries. Never flattened.
 *
 * IMMUTABILITY RULE: VariantRecord is frozen. ClinicalEvidence attaches
 * alongside it via the same clinvarVariationId key without modifying it.
 *
 * SOURCE: ClinVar VCV EFetch XML
 *   efetch.fcgi?db=clinvar&rettype=vcv&id=VCV{accession}&retmode=xml
 *   One HTTP call returns both RCV metadata and all SCVs bundled.
 *   There is no separate cheaper count-only endpoint — SubmissionCount is
 *   available as a native attribute in each RCV's <Description @SubmissionCount>,
 *   but the full SCV list is in the same response body. Per 5.5B-1's Step 5
 *   explicit rule, expansion is a UI-only toggle, not a new network call.
 *
 * SCOPE (Phase 5.5B-1):
 *   - GermlineClassification only (somatic/oncogenicity is 5.5B-2+)
 *   - No VariantResearchContext (5.5B-2)
 *   - No review-status star rendering (5.5B-2)
 *   - No PubMed citation mining, population frequency, gnomAD
 *   - No LLM-generated text
 */

/** Top-level container — keyed by clinvarVariationId to match VariantRecord. */
export interface ClinicalEvidence {
  clinvarVariationId: string;
  interpretations: readonly ConditionInterpretation[];
}

/**
 * One condition-interpretation (one RCV). A variant may have multiple
 * ConditionInterpretation entries when it is classified for different conditions.
 */
export interface ConditionInterpretation {
  /** ClinVar RCV accession, e.g. "RCV006449648". */
  rcvAccession: string;

  /** Conditions asserted by this interpretation. Usually one; rarely more. */
  conditions: readonly ClinicalCondition[];

  /**
   * ClinVar's own aggregate germline classification for this condition.
   * Preserved exactly as the source provides — never recomputed, never voted,
   * never averaged across submissions.
   * e.g. "Pathogenic", "Uncertain significance", "Conflicting classifications of pathogenicity"
   */
  aggregateClassification: string | null;

  /**
   * ClinVar's own aggregate review status for this condition.
   * Raw text from <ReviewStatus> — no star rendering in 5.5B-1.
   * e.g. "criteria provided, single submitter",
   *      "criteria provided, multiple submitters, no conflicts",
   *      "no classification provided"
   */
  aggregateReviewStatus: string | null;

  /**
   * DateLastEvaluated from the RCV's <Description @DateLastEvaluated>.
   * ISO date string (YYYY-MM-DD) or null if not provided.
   */
  lastEvaluated: string | null;

  /**
   * Native SubmissionCount attribute from <Description @SubmissionCount>.
   * Count of submissions that contribute to this RCV's interpretation.
   * Available without fetching individual SCVs (attribute on the RCV element).
   */
  submissionCount: number;

  /**
   * Individual SCV submissions for this condition-interpretation.
   * Populated from ClinicalAssertionList in the same VCV XML response.
   * Since VCV EFetch returns RCVs and SCVs bundled (no separate call possible),
   * submissions[] is always populated when ClinicalEvidence is loaded.
   * The "expand" affordance in the UI is a show/hide toggle, not a network call.
   */
  submissions: readonly ClinicalSubmission[];
}

/** A single clinical condition asserted by a ConditionInterpretation. */
export interface ClinicalCondition {
  /** Condition name as ClinVar provides it — never reworded or merged. */
  name: string;

  /**
   * Cross-database identifiers for this condition.
   * Preserved as-is from ClassifiedCondition elements.
   * Primarily MedGen CUIs; may include OMIM, MONDO, etc. as 5.5B-2 adds more.
   */
  identifiers: readonly { database: string; id: string }[];
}

/** One SCV (individual submission) within a ConditionInterpretation. */
export interface ClinicalSubmission {
  /** ClinVar SCV accession, e.g. "SCV007331602". */
  scvAccession: string;

  /**
   * Submitted germline classification.
   * Raw text from <GermlineClassification> — preserved as-is.
   * e.g. "Likely Pathogenic", "Uncertain significance", "not provided"
   */
  significance: string | null;

  /**
   * Submission-level review status.
   * Raw text from <ReviewStatus> inside <Classification>.
   */
  reviewStatus: string | null;

  /** SubmitterName attribute from <ClinVarAccession @Type="SCV">. */
  submitter: string | null;

  /**
   * DateLastEvaluated from <Classification @DateLastEvaluated>.
   * ISO date string or null.
   */
  lastEvaluated: string | null;

  /**
   * Primary condition name asserted by this submission.
   * Derived from the SCV's MedGen XRef match to the parent ConditionInterpretation.
   * Null if condition could not be resolved.
   */
  conditionAsserted: string | null;

  /**
   * From <ClinicalAssertion @ContributesToAggregateClassification>.
   * Retired/non-contributing submissions (false) are preserved but flagged.
   */
  contributesToAggregate: boolean;
}
