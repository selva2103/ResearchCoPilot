/**
 * lib/clinical-evidence/index.ts — ClinicalEvidence retrieval service (Phase 5.5B-1)
 *
 * Public API:
 *   getClinicalEvidence(clinvarVariationId, clinvarAccession) → ClinicalEvidence | null
 *
 * Pipeline:
 *   1. Check in-memory cache (TTL: 24 hours — see rationale below)
 *   2. Build VCV-prefixed accession string (from clinvarAccession or zero-padded ID)
 *   3. VCV EFetch → raw XML
 *   4. Parse XML → ClinicalEvidence
 *   5. Cache result + return
 *
 * CACHE ARCHITECTURE (consistent with 5.5A's fix session resolution):
 *   In-memory Map — same pattern as lib/variant/index.ts, lib/protein/index.ts,
 *   lib/gene/index.ts. No Redis, no new caching mechanism. Module-level singleton.
 *
 *   Cache key: "clinicalevidence:{clinvarVariationId}" (identity-scoped, not query-scoped)
 *   This is single-entity data keyed by variation ID — no pagination, filter, or sort
 *   dimensions, unlike the variant list's query-scoped key pattern.
 *
 *   TTL: 24 hours (86400000 ms)
 *   RATIONALE: ClinVar clinical assertions are updated on a weekly+ cycle
 *   (submitters update periodically; NCBI processes weekly). A 24h TTL balances
 *   freshness with NCBI API load. In contrast, protein research contexts are
 *   effectively permanent (sequence data doesn't change). Clinical assertions
 *   do change (reclassification happens), so some TTL is appropriate.
 *   Process-restart eviction is acceptable — see 5.5A fix session Issue 2.
 *
 * LAZY LOADING:
 *   This module is called ONLY when a user expands a specific variant to view
 *   its clinical evidence. It is NEVER called during variant list loading.
 *   One VCV EFetch returns both RCV metadata and SCV submissions bundled —
 *   no separate fetch is possible. Expansion UI is show/hide of already-loaded data.
 *
 * RATE LIMIT:
 *   Reuses VARIANT_RATE_DELAY_MS (350ms) from lib/variant/search.ts.
 *   No new rate limiter. Clinical evidence fetches are user-triggered (one at a time).
 *
 * NON-HUMAN GUARD:
 *   Enforced by the route handler (app/api/clinical-evidence/route.ts) — same pattern
 *   as variant list route. This module does not check organism.
 */

import type { ClinicalEvidence } from "@/types/clinical-evidence";
import { fetchClinVarVCVXml, buildVcvAccession } from "./clinvar-retrieval";
import { parseClinVarVCVXml } from "./parse";

// ── In-memory cache (same abstraction as lib/variant/index.ts) ─────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: ClinicalEvidence;
  fetchedAt: number;  // Date.now() timestamp
}

const evidenceCache = new Map<string, CacheEntry>();

function buildCacheKey(clinvarVariationId: string): string {
  return `clinicalevidence:${clinvarVariationId}`;
}

function getCached(clinvarVariationId: string): ClinicalEvidence | null {
  const key = buildCacheKey(clinvarVariationId);
  const entry = evidenceCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    evidenceCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(data: ClinicalEvidence): void {
  const key = buildCacheKey(data.clinvarVariationId);
  evidenceCache.set(key, { data, fetchedAt: Date.now() });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Retrieve ClinicalEvidence for a ClinVar variation.
 * Returns null if the variation has no formal interpretations (empty RCVList).
 * Throws on NCBI API failures (handled by the route into an error response).
 *
 * @param clinvarVariationId - Numeric variation ID string, e.g. "4685939"
 * @param clinvarAccession   - VCV-prefixed accession from VariantRecord, e.g. "VCV004685939"
 *   Pass null to auto-construct from clinvarVariationId (9-digit zero-padding).
 */
export async function getClinicalEvidence(
  clinvarVariationId: string,
  clinvarAccession: string | null
): Promise<ClinicalEvidence | null> {
  // ── Cache check ──────────────────────────────────────────────────────────────
  const cached = getCached(clinvarVariationId);
  if (cached !== null) return cached;

  // ── Build VCV accession ──────────────────────────────────────────────────────
  const vcvAccession = buildVcvAccession(clinvarAccession, clinvarVariationId);

  // ── Fetch + parse ────────────────────────────────────────────────────────────
  const xml = await fetchClinVarVCVXml(vcvAccession);
  const evidence = parseClinVarVCVXml(xml, clinvarVariationId);

  if (evidence === null) {
    // Fundamentally unparseable XML — return null (route reports as error)
    return null;
  }

  // Cache even empty-interpretation results so we don't re-fetch a variant
  // that genuinely has no formal ClinVar review
  setCached(evidence);
  return evidence;
}
