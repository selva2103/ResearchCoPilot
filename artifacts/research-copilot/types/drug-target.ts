/**
 * types/drug-target.ts - Phase 5.10A
 *
 * Drugs and clinical candidates for a human gene, from Open Targets Platform.
 * Gene-level (Ensembl gene ID). Stage strings are kept exactly as returned.
 * rowStage is the stage on the target-specific row; drugStage is the drug's overall
 * stage. They can differ and this module does not interpret the difference.
 */

export type DrugTargetSourceStatus = "not-attempted" | "success" | "empty" | "error";
export type DrugTargetAvailability =
  | "available"
  | "none"
  | "unresolved"
  | "source-failure"
  | "not-applicable";

export interface DrugMechanism {
  mechanismOfAction: string;
  actionType: string | null;
  /** Target of the drug's mechanism; may be a different protein than the queried gene. */
  targetName: string | null;
}

export interface DrugCandidate {
  chemblId: string;
  name: string;
  drugType: string | null;
  rowStage: string | null;
  drugStage: string | null;
  mechanisms: DrugMechanism[];
}

export interface DrugTargetResult {
  ensemblId: string;
  approvedSymbol: string | null;
  availability: DrugTargetAvailability;
  sourceStatus: DrugTargetSourceStatus;
  /** Open Targets data release, e.g. "26.09". null when not returned. */
  dataVersion: string | null;
  totalCount: number;
  candidates: DrugCandidate[];
}
