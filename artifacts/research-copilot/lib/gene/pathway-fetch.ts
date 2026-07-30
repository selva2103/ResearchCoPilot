/**
 * lib/gene/pathway-fetch.ts — Reactome pathway membership retrieval (Phase 5.6B)
 *
 * AUDIT DECISION (Phase 5.6B, 2026-07-29):
 *   Source: Reactome Analysis Service — POST /AnalysisService/identifiers/
 *   Input:  gene symbol (plain text POST body) — already resolved upstream by Phase R
 *   Reason: 129 human / 51 mouse pathways per gene (directly); WikiPathways API is
 *           inaccessible (all endpoints 404/406); NCBI ELink gives only ~9% coverage.
 *   Full evidence: PHASE-5.6B-AUDIT-FINDINGS.md
 *
 * NEW EXTERNAL HOST:
 *   reactome.org is the first non-NCBI host in this project. Per Phase 5.6B architectural
 *   constraints, a completely independent rate limiter is used — NOT shared with the NCBI
 *   rate limiter in lib/gene/search.ts. Different host, different limits, different chain.
 *   Reactome has no published strict rate limit; 500ms between requests is conservative.
 *
 * CACHE:
 *   Key:  pathway:{geneId}  — keyed by geneId (NCBI Gene ID), NOT geneSymbol or pathwayId
 *   TTL:  24 hours — Reactome pathway updates release monthly; daily cache is appropriate
 *   Implementation: module-level Map<string, CacheEntry>, same pattern as go-fetch.ts
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneSymbol and geneId are consumed from the already-resolved GeneRecord.
 *   This module NEVER independently re-resolves gene identity.
 *   If the submitted symbol returns no results from Reactome, that is an empty result —
 *   NOT a trigger to retry with a different identifier.
 *
 * DUPLICATE SUPPRESSION:
 *   Reactome Analysis Service returns one entry per pathway per gene — no source-level
 *   duplicates possible. Entries from different source DBs (if WikiPathways is ever added)
 *   are NEVER merged based on name similarity — only literally-identical pathwayId values
 *   would collapse, which cannot occur across different databases.
 */

import { fetchWithRetry } from "@/lib/utils";
import type { PathwayMembership } from "@/types/pathway-membership";

// ── Reactome Analysis Service configuration ───────────────────────────────────

const REACTOME_ANALYSIS_URL =
  "https://reactome.org/AnalysisService/identifiers/?" +
  "interactors=false&sortBy=ENTITIES_PVALUE&order=ASC&resource=TOTAL&pValue=1&includeDisease=true";

/** sourceUrl template: canonical Reactome browser permalink for a pathway. */
const REACTOME_BROWSER_URL = (stId: string) =>
  `https://reactome.org/PathwayBrowser/#/${stId}`;

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: PathwayMembership[];
  fetchedAt: number;
}

const pathwayCache = new Map<string, CacheEntry>();

function buildCacheKey(geneId: string): string {
  return `pathway:${geneId}`;
}

function getCached(geneId: string): PathwayMembership[] | null {
  const entry = pathwayCache.get(buildCacheKey(geneId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    pathwayCache.delete(buildCacheKey(geneId));
    return null;
  }
  return entry.data;
}

function setCached(geneId: string, data: PathwayMembership[]): void {
  pathwayCache.set(buildCacheKey(geneId), { data, fetchedAt: Date.now() });
}

export function isPathwayCached(geneId: string): boolean {
  return getCached(geneId) !== null;
}

// ── Independent Reactome rate limiter ─────────────────────────────────────────
// COMPLETELY SEPARATE from the NCBI rate limiter in lib/gene/search.ts.
// Different host → different limits → independent sequential promise chain.
// 500ms delay is conservative (Reactome has no strict published rate limit).

const REACTOME_RATE_DELAY_MS = 500;

let reactomeFetchChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withReactomeRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const next = reactomeFetchChain.then(() => fn());
  reactomeFetchChain = next
    .then(() => sleep(REACTOME_RATE_DELAY_MS))
    .catch(() => sleep(REACTOME_RATE_DELAY_MS));
  return next;
}

// ── Reactome Analysis Service response types ──────────────────────────────────
// Only the fields we consume; extra fields are ignored.

interface ReactomeAnalysisPathway {
  stId: string;
  name: string;
  species: {
    taxId: string;
    name: string;
  };
  inDisease: boolean;
  // entities, reactions, dbId, llp — present but not needed for PathwayMembership
}

interface ReactomeAnalysisResponse {
  pathways?: ReactomeAnalysisPathway[];
  // summary, expressionSummary, identifiersNotFound — ignored
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchReactomePathways(
  geneSymbol: string,
): Promise<ReactomeAnalysisPathway[]> {
  // POST body is a plain-text gene symbol — Reactome Analysis Service format
  const res = await fetchWithRetry(REACTOME_ANALYSIS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Accept: "application/json",
      "User-Agent": "ResearchCoPilot/1.0",
    },
    body: geneSymbol,
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("HTTP 429 — Reactome Analysis Service rate limit hit");
    }
    throw new Error(
      `Reactome Analysis Service HTTP ${res.status} for symbol=${geneSymbol}`,
    );
  }

  const json: ReactomeAnalysisResponse = await res.json();
  return json.pathways ?? [];
}

// ── Response → PathwayMembership[] ───────────────────────────────────────────

/**
 * Convert Reactome API pathways to PathwayMembership[].
 *
 * SPECIES FILTER (Phase 5.6C hardening):
 *   The Reactome Analysis Service POST /AnalysisService/identifiers/ endpoint
 *   returns pathways for ALL species by default (e.g. querying "TP53" returns
 *   both R-HSA-* human pathways and R-MMU-* mouse ortholog pathways).
 *   We filter to only include pathways whose species.name exactly matches the
 *   `organism` of the query gene — no cross-species leakage.
 *   Exact case-sensitive comparison is used because Reactome species names are
 *   always fully qualified (e.g. "Homo sapiens", "Mus musculus").
 */
function toPathwayMemberships(
  pathways: ReactomeAnalysisPathway[],
  geneId: string,
  geneSymbol: string,
  organism: string,
): PathwayMembership[] {
  const results: PathwayMembership[] = [];

  for (const p of pathways) {
    // Skip malformed entries individually; preserve the rest
    if (!p.stId || !p.name || !p.species?.name) continue;

    // Filter: only include pathways whose species matches the query gene's organism.
    // Reactome returns cross-species orthologs; we retain only the relevant species.
    if (p.species.name !== organism) continue;

    results.push({
      pathwayId: p.stId,
      pathwayName: p.name,
      source: "reactome",
      sourceUrl: REACTOME_BROWSER_URL(p.stId),
      organism: p.species.name,
      geneId,
      geneSymbol,
      inDisease: Boolean(p.inDisease),
    });
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve Reactome pathway memberships for a gene.
 *
 * Uses Reactome Analysis Service (POST /AnalysisService/identifiers/) with the
 * gene symbol as input. Species is automatically determined by Reactome from the
 * symbol — no additional organism mapping is needed.
 *
 * Cache: keyed by `pathway:{geneId}`. TTL 24 hours.
 * Rate limit: 500ms sequential delay, independent from NCBI limiter.
 *
 * @param geneId      NCBI Gene ID — already resolved upstream; for cache key + output.
 * @param geneSymbol  Gene symbol — already resolved upstream; used as Reactome input.
 * @param organism    Organism scientific name — already resolved upstream; display only.
 * @returns Array of PathwayMembership (may be empty for unannotated genes).
 * @throws On network/HTTP error after retries exhausted.
 */
export async function getGenePathways(
  geneId: string,
  geneSymbol: string,
  organism: string,
): Promise<PathwayMembership[]> {
  // ── Cache hit ────────────────────────────────────────────────────────────────
  const cached = getCached(geneId);
  if (cached !== null) return cached;

  // ── Rate-limited fetch ────────────────────────────────────────────────────────
  return withReactomeRateLimit(async () => {
    // Double-check cache after acquiring rate-limit slot
    const postWaitCached = getCached(geneId);
    if (postWaitCached !== null) return postWaitCached;

    const rawPathways = await fetchReactomePathways(geneSymbol);
    const memberships = toPathwayMemberships(rawPathways, geneId, geneSymbol, organism);
    setCached(geneId, memberships);
    return memberships;
  });
}
