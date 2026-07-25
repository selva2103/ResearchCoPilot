/**
 * lib/clinical-evidence/review-status.ts — ClinVar review status → star mapping (Phase 5.5B-2)
 *
 * AUTHORITATIVE MAPPING: ClinVar's own 4-tier review status system.
 * Source: https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/
 *
 * This is a PURE UTILITY module — no UI, no React, no network calls.
 * The mapping function belongs here; the rendering component belongs in the
 * consuming UI component. The component's only job is to render the number it is given.
 *
 * STAR TIERS (ClinVar's own published tiers):
 *   4 ★ — practice guideline
 *   3 ★ — reviewed by expert panel
 *   2 ★ — criteria provided, multiple submitters, no conflicts
 *   1 ★ — criteria provided, single submitter
 *   1 ★ — criteria provided, conflicting classifications
 *   0 ★ — no assertion criteria provided
 *   0 ★ — no classification provided
 *   0 ★ — no assertion provided
 *  null — unmapped value: render raw text, no stars (Step 7 fallback)
 *
 * RECONCILIATION NOTE (5.5B-2):
 *   The Phase 5.5B-1 audit table provisionally placed "no assertion criteria provided"
 *   at 1 star. The Phase 5.5B-2 non-negotiable constraints explicitly place it at 0 stars
 *   (consistent with ClinVar's own published tiering). The 5.5B-2 mapping is authoritative.
 *
 * LABELED AS: ClinVar review status — never "confidence" (avoid confusion with
 *   Phase R's Resolver Confidence or Phase 5.4B's Annotation Confidence).
 */

/** All observed ClinVar review status text values, normalised to lowercase. */
const REVIEW_STATUS_STARS: ReadonlyMap<string, number> = new Map([
  // Tier 4
  ["practice guideline", 4],
  // Tier 3
  ["reviewed by expert panel", 3],
  // Tier 2
  ["criteria provided, multiple submitters, no conflicts", 2],
  // Tier 1 — ClinVar places both single-submitter and conflicting at 1 star
  ["criteria provided, single submitter", 1],
  ["criteria provided, conflicting classifications", 1],
  // Tier 0 — No assertion criteria / no classification / no assertion
  ["no assertion criteria provided", 0],
  ["no classification provided", 0],
  ["no assertion provided", 0],
]);

/**
 * Map a ClinVar review status string to a star count (0–4).
 *
 * Returns null for any string that does not match a known tier —
 * the UI must fall back to showing raw text with no stars in that case.
 * Never crashes; never fabricates a tier.
 *
 * @param rawStatus — the raw review status string from ClinVar (any case).
 */
export function reviewStatusToStars(rawStatus: string | null): number | null {
  if (!rawStatus) return null;
  const normalised = rawStatus.trim().toLowerCase();
  const stars = REVIEW_STATUS_STARS.get(normalised);
  return stars !== undefined ? stars : null;
}

/**
 * All review status strings that this mapping covers, for documentation/testing.
 * @internal
 */
export const KNOWN_REVIEW_STATUSES: ReadonlyArray<string> = Array.from(
  REVIEW_STATUS_STARS.keys()
);
