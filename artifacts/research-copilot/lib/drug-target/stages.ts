/**
 * lib/drug-target/stages.ts - Phase 5.10A
 *
 * Pure display helpers for Open Targets clinical stage strings. No imports, so it is
 * safe in both client and server code. The order below is DISPLAY ORDER ONLY and says
 * nothing about what a stage means. Unknown strings are shown unchanged and sort after
 * the known ones.
 */

const STAGE_LABELS: Record<string, string> = {
  PHASE_1: "Phase 1",
  PHASE_1_2: "Phase 1/2",
  PHASE_2: "Phase 2",
  PHASE_2_3: "Phase 2/3",
  PHASE_3: "Phase 3",
  PHASE_4: "Phase 4",
  APPROVAL: "Approval",
  WITHDRAWAL: "Withdrawal",
  UNKNOWN: "Unknown",
};

const STAGE_ORDER = [
  "APPROVAL",
  "PHASE_4",
  "PHASE_3",
  "PHASE_2_3",
  "PHASE_2",
  "PHASE_1_2",
  "PHASE_1",
  "WITHDRAWAL",
  "UNKNOWN",
];

export function stageLabel(stage: string | null): string {
  if (!stage) return "Not stated";
  return STAGE_LABELS[stage] ?? stage;
}

export function stageRank(stage: string | null): number {
  if (!stage) return STAGE_ORDER.length + 1;
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? STAGE_ORDER.length : i;
}
