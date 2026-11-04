/**
 * types/drug-target-extras.ts - Phase 5.10B
 *
 * Tractability (gene-level) and per-drug indications from Open Targets Platform.
 * Tractability is an in silico assessment by Open Targets, not evidence that a drug works.
 * Indications belong to the drug overall, not only to the queried gene.
 */

export type ExtraAvailability =
  | "available"
  | "none"
  | "unresolved"
  | "source-failure"
  | "not-applicable";

export interface TractabilityEntry {
  /** Open Targets modality code: SM, AB, PR or OC. Unknown codes are kept as returned. */
  modality: string;
  label: string;
  value: boolean;
}

export interface TractabilityResult {
  ensemblId: string;
  availability: ExtraAvailability;
  dataVersion: string | null;
  /** Number of assessments returned (true and false). */
  assessedCount: number;
  /** Only the assessments that are true. */
  positives: TractabilityEntry[];
}

export interface DrugIndication {
  diseaseId: string | null;
  diseaseName: string;
  /** Stage string exactly as returned by Open Targets. */
  stage: string | null;
}

export interface DrugIndicationsResult {
  chemblId: string;
  availability: ExtraAvailability;
  totalCount: number;
  indications: DrugIndication[];
}
