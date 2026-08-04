/**
 * lib/protein/identifier-resolver.ts — Phase 5.7A
 *
 * ProteinIdentifierResolver
 * ─────────────────────────
 * Resolves a RefSeq protein accession (NP_/XP_) to a UniProt accession via the
 * official UniProt ID Mapping API (RefSeq_Protein → UniProtKB).
 *
 * WHY A SEPARATE SERVICE:
 *   InterPro (and future phases: AlphaFold 5.8, STRING 5.9, etc.) require UniProt
 *   accessions as input. The UniProt ID Mapping API is the official EBI-sanctioned
 *   bridge. This resolver is the single, canonical mapping layer — no other module
 *   may independently re-derive the RefSeq→UniProt mapping.
 *
 * MULTI-MAPPING RULE (Step 1 decision, Phase 5.7A):
 *   A RefSeq accession may map to multiple UniProt entries (e.g. the Swiss-Prot
 *   canonical plus several TrEMBL fragments/isoforms). Resolution rule:
 *     (a) Exactly 1 reviewed (Swiss-Prot) entry → resolutionStatus = "resolved"
 *     (b) 2+ reviewed entries                   → resolutionStatus = "ambiguous"
 *     (c) 0 reviewed entries                    → resolutionStatus = "unresolved"
 *   Never silently pick "the first result."
 *
 * PROVISIONAL STATUS:
 *   ProteinIdentifierResolver is built as a reusable service because future phases
 *   will need RefSeq→UniProt resolution. It is NOT part of Frozen Architecture in
 *   Phase 5.7A — freeze eligibility assessed after Phase 5.8 validates it as a
 *   second consumer.
 *
 * POLLING POLICY:
 *   The UniProt ID Mapping API is async (submit job → poll status → fetch results).
 *   This service polls up to MAX_POLL_ATTEMPTS times with POLL_INTERVAL_MS delay.
 *   A timeout (all polls exhausted without completion) is treated as a transient
 *   failure, NOT as "unresolved" — timeouts are retryable. The cache preserves both
 *   resolved and deterministically-unresolved/ambiguous outcomes so repeated lookups
 *   for known-unresolvable proteins don't re-hit the API every time.
 *
 * NEW EXTERNAL HOST:
 *   rest.uniprot.org — independent from NCBI and Reactome. Own rate limiter (sequential
 *   promise chain, 300ms between requests). Own cache namespace: protein-id-map:{accession}.
 *
 * CACHE:
 *   Key: protein-id-map:{refseqAccession}
 *   TTL: 24 hours (same policy as go-fetch.ts, pathway-fetch.ts)
 *   Scope: resolved, unresolved, and ambiguous outcomes are all cached.
 *          Timeout/network-error outcomes are NOT cached — they should retry.
 */

import { fetchWithRetry } from "@/lib/utils";
import type { ProteinIdentifierMapping } from "@/types/protein-domain";

// ── API configuration ─────────────────────────────────────────────────────────

const UNIPROT_IDMAPPING_RUN_URL = "https://rest.uniprot.org/idmapping/run";
const UNIPROT_IDMAPPING_STATUS_URL = (jobId: string) =>
  `https://rest.uniprot.org/idmapping/status/${jobId}`;
const UNIPROT_IDMAPPING_RESULTS_URL = (jobId: string) =>
  `https://rest.uniprot.org/idmapping/results/${jobId}?format=json`;

/** Max polling attempts before treating as a transient timeout. */
const MAX_POLL_ATTEMPTS = 12;
/** Milliseconds between each poll. */
const POLL_INTERVAL_MS = 2000;

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: ProteinIdentifierMapping;
  fetchedAt: number;
}

const mappingCache = new Map<string, CacheEntry>();

function buildCacheKey(refseqAccession: string): string {
  return `protein-id-map:${refseqAccession}`;
}

function getCached(refseqAccession: string): ProteinIdentifierMapping | null {
  const entry = mappingCache.get(buildCacheKey(refseqAccession));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    mappingCache.delete(buildCacheKey(refseqAccession));
    return null;
  }
  return entry.data;
}

function setCached(refseqAccession: string, data: ProteinIdentifierMapping): void {
  mappingCache.set(buildCacheKey(refseqAccession), { data, fetchedAt: Date.now() });
}

export function isIdentifierMappingCached(refseqAccession: string): boolean {
  return getCached(refseqAccession) !== null;
}

// ── Independent UniProt rate limiter ──────────────────────────────────────────
// Completely separate from NCBI (lib/gene/search.ts) and Reactome (pathway-fetch.ts).
// rest.uniprot.org has no strict published limit; 300ms is conservative.

const UNIPROT_RATE_DELAY_MS = 300;

let uniprotFetchChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withUniprotRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const next = uniprotFetchChain.then(() => fn());
  uniprotFetchChain = next
    .then(() => sleep(UNIPROT_RATE_DELAY_MS))
    .catch(() => sleep(UNIPROT_RATE_DELAY_MS));
  return next;
}

// ── UniProt ID Mapping API response types ─────────────────────────────────────
// Only fields consumed; extra fields are ignored.

interface UniProtMappingResult {
  from: string;
  to: {
    primaryAccession: string;
    entryType: string; // "UniProtKB reviewed (Swiss-Prot)" | "UniProtKB unreviewed (TrEMBL)"
  } | string; // some paginated responses return strings for TrEMBL
}

interface UniProtMappingResultsResponse {
  results?: UniProtMappingResult[];
}

interface UniProtMappingStatusResponse {
  jobStatus?: string; // "RUNNING" | "FINISHED" | "ERROR"
  results?: UniProtMappingResult[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isReviewed(entry: UniProtMappingResult): boolean {
  const to = entry.to;
  if (typeof to === "string") return false;
  const entryType = to.entryType ?? "";
  return entryType.includes("Swiss-Prot") || entryType === "UniProtKB reviewed (Swiss-Prot)";
}

function getAccession(entry: UniProtMappingResult): string {
  const to = entry.to;
  if (typeof to === "string") return to;
  return to.primaryAccession ?? "";
}

// ── Core API calls ────────────────────────────────────────────────────────────

async function submitMappingJob(refseqAccession: string): Promise<string> {
  const formData = new FormData();
  formData.append("from", "RefSeq_Protein");
  formData.append("to", "UniProtKB");
  formData.append("ids", refseqAccession);

  const res = await fetchWithRetry(UNIPROT_IDMAPPING_RUN_URL, {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 — UniProt ID Mapping rate limit hit");
    throw new Error(`UniProt ID Mapping submit HTTP ${res.status} for ${refseqAccession}`);
  }

  const json = await res.json() as { jobId?: string };
  if (!json.jobId) throw new Error("UniProt ID Mapping: no jobId in submit response");
  return json.jobId;
}

async function pollMappingJob(jobId: string): Promise<UniProtMappingResult[]> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(POLL_INTERVAL_MS);

    const res = await fetchWithRetry(UNIPROT_IDMAPPING_STATUS_URL(jobId), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      if (res.status === 429) throw new Error("HTTP 429 — UniProt ID Mapping rate limit hit");
      throw new Error(`UniProt ID Mapping poll HTTP ${res.status} for job=${jobId}`);
    }

    const json = await res.json() as UniProtMappingStatusResponse;

    // Status "RUNNING" — keep polling
    if (json.jobStatus === "RUNNING") continue;

    // Status "ERROR" from API
    if (json.jobStatus === "ERROR") {
      throw new Error(`UniProt ID Mapping job ${jobId} returned ERROR status`);
    }

    // Job is complete — results may be inline (small jobs) or need a separate fetch
    if (json.results !== undefined) {
      return json.results;
    }

    // No results inline → fetch from results endpoint
    return fetchMappingResults(jobId);
  }

  // All poll attempts exhausted — transient timeout, NOT a confirmed unresolved mapping
  throw new Error(
    `UniProt ID Mapping job ${jobId} did not complete within ${MAX_POLL_ATTEMPTS} attempts`
  );
}

async function fetchMappingResults(jobId: string): Promise<UniProtMappingResult[]> {
  const res = await fetchWithRetry(UNIPROT_IDMAPPING_RESULTS_URL(jobId), {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 — UniProt ID Mapping rate limit hit");
    throw new Error(`UniProt ID Mapping results HTTP ${res.status} for job=${jobId}`);
  }

  const json = await res.json() as UniProtMappingResultsResponse;
  return json.results ?? [];
}

// ── Resolution logic ──────────────────────────────────────────────────────────

function applyMultiMappingRule(
  refseqAccession: string,
  results: UniProtMappingResult[]
): ProteinIdentifierMapping {
  const reviewed = results.filter(isReviewed);

  if (reviewed.length === 1) {
    // (a) exactly one reviewed entry → resolved
    return {
      refseqAccession,
      uniprotAccession: getAccession(reviewed[0]),
      reviewed: true,
      resolutionStatus: "resolved",
      source: "uniprot-id-mapping",
    };
  }

  if (reviewed.length > 1) {
    // (b) multiple reviewed entries → ambiguous; never auto-pick
    return {
      refseqAccession,
      uniprotAccession: null,
      reviewed: null,
      resolutionStatus: "ambiguous",
      source: "uniprot-id-mapping",
    };
  }

  // (c) zero reviewed entries → unresolved
  return {
    refseqAccession,
    uniprotAccession: null,
    reviewed: null,
    resolutionStatus: "unresolved",
    source: "uniprot-id-mapping",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a RefSeq protein accession to a UniProt accession.
 *
 * Uses the UniProt ID Mapping API (async job: submit → poll → results).
 * Applies deterministic multi-mapping rule: selects a single reviewed
 * Swiss-Prot entry if exactly one exists; otherwise returns ambiguous/unresolved.
 *
 * Cache: keyed by `protein-id-map:{refseqAccession}`. TTL 24 hours.
 *   Resolved, unresolved, and ambiguous results are all cached.
 *   Timeout/network-error results are NOT cached — they should retry on next call.
 *
 * Rate limit: 300ms sequential delay, independent from NCBI and Reactome limiters.
 *
 * @throws On network error or transient timeout (distinguishable from "unresolved"
 *   which is a valid deterministic outcome and IS cached).
 */
export async function resolveProteinIdentifier(
  refseqAccession: string
): Promise<ProteinIdentifierMapping> {
  // ── Cache hit ─────────────────────────────────────────────────────────────
  const cached = getCached(refseqAccession);
  if (cached !== null) return cached;

  // ── Rate-limited resolution ───────────────────────────────────────────────
  return withUniprotRateLimit(async () => {
    // Double-check cache after acquiring rate-limit slot
    const postWaitCached = getCached(refseqAccession);
    if (postWaitCached !== null) return postWaitCached;

    const jobId = await submitMappingJob(refseqAccession);
    const results = await pollMappingJob(jobId);
    const mapping = applyMultiMappingRule(refseqAccession, results);

    // Cache all deterministic outcomes (resolved, unresolved, ambiguous).
    // Do NOT cache here on throw — timeout/network failures skip setCached.
    setCached(refseqAccession, mapping);
    return mapping;
  });
}
