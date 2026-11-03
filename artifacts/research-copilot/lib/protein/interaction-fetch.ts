/**
 * lib/protein/interaction-fetch.ts - Phase 5.9A
 *
 * STRING protein-protein association retrieval. Consumes a resolved UniProt accession
 * from ProteinIdentifierResolver (never calls UniProt mapping itself), maps it to a
 * STRING ID, then fetches interaction partners.
 *
 * Flow: UniProt accession -> STRING get_string_ids (species = requested taxon) ->
 *       STRING interaction_partners.
 *
 * Mapping guard: a STRING match is accepted only if its ncbiTaxonId equals the requested
 * taxon; an empty array also means "unresolved" (STRING returns HTTP 200 with []).
 *
 * Failure model: a STRING failure is reported as sourceStatus "error" / availability
 * "source-failure" and is never cached. "empty" and "unresolved" outcomes are cached.
 *
 * Rate limiting: STRING asks callers to wait about one second between calls and to
 * identify themselves with caller_identity; one limiter serializes all STRING calls.
 */

import { fetchWithRetry as baseFetchWithRetry } from "@/lib/utils";
import type { ProteinIdentifierMapping } from "@/types/protein-domain";
import type {
  InteractionChannelScores,
  InteractionResolutionResult,
  ProteinInteractionPartner,
} from "@/types/protein-interaction";

const STRING_API_BASE = "https://string-db.org/api/json";
const CALLER_IDENTITY = "ResearchCoPilot";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 25000;
const STRING_DELAY_MS = 1100;

interface StringIdRow {
  stringId?: string;
  ncbiTaxonId?: number | string;
  preferredName?: string;
}

interface StringPartnerRow {
  stringId_A?: string;
  stringId_B?: string;
  preferredName_A?: string;
  preferredName_B?: string;
  ncbiTaxonId?: number | string;
  score?: number;
  nscore?: number;
  fscore?: number;
  pscore?: number;
  ascore?: number;
  escore?: number;
  dscore?: number;
  tscore?: number;
}

// ── Cache (results only; errors are never cached) ─────────────────────────────

interface CacheEntry {
  data: InteractionResolutionResult;
  fetchedAt: number;
}
const resultCache = new Map<string, CacheEntry>();

function buildCacheKey(refseq: string, taxonId: number, minScore: number, limit: number): string {
  return `interactions-string:${refseq}:${taxonId}:${minScore}:${limit}`;
}

function readCache(key: string): InteractionResolutionResult | null {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache(key: string, data: InteractionResolutionResult): void {
  resultCache.set(key, { data, fetchedAt: Date.now() });
}

export function isInteractionCached(
  refseq: string,
  taxonId: number,
  minScore: number,
  limit: number
): boolean {
  return readCache(buildCacheKey(refseq, taxonId, minScore, limit)) !== null;
}

// ── Limiter + fetch ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeLimiter(delayMs: number) {
  let chain: Promise<void> = Promise.resolve();
  return function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.then(() => sleep(delayMs)).catch(() => sleep(delayMs));
    return next;
  };
}

const withStringLimit = makeLimiter(STRING_DELAY_MS);

export async function fetchStringJson<T>(method: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, caller_identity: CALLER_IDENTITY });
  const url = `${STRING_API_BASE}/${method}?${qs.toString()}`;
  return withStringLimit(async () => {
    const res = await baseFetchWithRetry(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from STRING (${method})`);
    return (await res.json()) as T;
  });
}

let versionCache: { value: string; fetchedAt: number } | null = null;

/** STRING release string (informational). Never throws; null when unavailable. */
export async function getStringVersion(): Promise<string | null> {
  if (versionCache && Date.now() - versionCache.fetchedAt < CACHE_TTL_MS) return versionCache.value;
  try {
    const rows = await fetchStringJson<Array<{ string_version?: string }>>("version", {});
    const v = Array.isArray(rows) ? rows[0]?.string_version : undefined;
    if (typeof v === "string" && v) {
      versionCache = { value: v, fetchedAt: Date.now() };
      return v;
    }
  } catch {
    // informational only: a version failure never fails the lookup
  }
  return null;
}

// ── Normalization ─────────────────────────────────────────────────────────────

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function toChannelScores(row: StringPartnerRow): InteractionChannelScores {
  return {
    neighborhood: numOrNull(row.nscore),
    fusion: numOrNull(row.fscore),
    cooccurrence: numOrNull(row.pscore),
    coexpression: numOrNull(row.ascore),
    experiments: numOrNull(row.escore),
    databases: numOrNull(row.dscore),
    textmining: numOrNull(row.tscore),
  };
}

function toPartner(row: StringPartnerRow, queryStringId: string): ProteinInteractionPartner | null {
  const aIsQuery = row.stringId_A === queryStringId;
  const bIsQuery = row.stringId_B === queryStringId;
  if (aIsQuery === bIsQuery) return null; // neither side is the query, or a self-interaction
  const partnerStringId = aIsQuery ? row.stringId_B : row.stringId_A;
  const partnerName = aIsQuery ? row.preferredName_B : row.preferredName_A;
  const score = numOrNull(row.score);
  const taxon = Number(row.ncbiTaxonId);
  if (!partnerStringId || !partnerName) return null;
  if (score === null || score < 0 || score > 1) return null;
  if (!Number.isFinite(taxon)) return null;
  return {
    partnerName,
    partnerStringId,
    ncbiTaxonId: taxon,
    combinedScore: score,
    channelScores: toChannelScores(row),
    partnerUniprot: null,
  };
}

function normalizePartners(rows: StringPartnerRow[], queryStringId: string): ProteinInteractionPartner[] {
  const best = new Map<string, ProteinInteractionPartner>();
  for (const row of rows) {
    const p = toPartner(row, queryStringId);
    if (!p) continue;
    const prev = best.get(p.partnerStringId);
    if (!prev || p.combinedScore > prev.combinedScore) best.set(p.partnerStringId, p);
  }
  return Array.from(best.values()).sort(
    (a, b) => b.combinedScore - a.combinedScore || a.partnerName.localeCompare(b.partnerName)
  );
}

function baseResult(minScore: number, limit: number): InteractionResolutionResult {
  return {
    identifierStatus: "unresolved",
    stringMappingStatus: "not-attempted",
    availability: "none",
    sourceStatus: "not-attempted",
    queryProtein: null,
    stringVersion: null,
    minScore,
    limit,
    partners: [],
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve STRING interaction partners for a protein already mapped to UniProt.
 *
 * @param mapping   RefSeq -> UniProt mapping from resolveProteinIdentifier
 * @param taxonId   NCBI Taxonomy ID of the protein's organism (from the gene record)
 * @param minScore  Minimum combined score on STRING's 0-1000 scale
 * @param limit     Maximum number of partners
 */
export async function getProteinInteractionResult(
  mapping: ProteinIdentifierMapping,
  taxonId: number,
  minScore: number,
  limit: number
): Promise<InteractionResolutionResult> {
  const base = baseResult(minScore, limit);
  if (mapping.resolutionStatus !== "resolved" || !mapping.uniprotAccession) return base;

  const key = buildCacheKey(mapping.refseqAccession, taxonId, minScore, limit);
  const cached = readCache(key);
  if (cached) return cached;

  const resolved: InteractionResolutionResult = { ...base, identifierStatus: "resolved" };

  // Step 1: UniProt accession -> STRING ID (species-restricted)
  let idRows: StringIdRow[];
  try {
    const rows = await fetchStringJson<StringIdRow[]>("get_string_ids", {
      identifiers: mapping.uniprotAccession,
      species: String(taxonId),
      limit: "1",
      echo_query: "1",
    });
    idRows = Array.isArray(rows) ? rows : [];
  } catch {
    return { ...resolved, availability: "source-failure", sourceStatus: "error" };
  }

  const match = idRows.find(
    (r) => typeof r.stringId === "string" && r.stringId !== "" && Number(r.ncbiTaxonId) === taxonId
  );
  if (!match || typeof match.stringId !== "string") {
    const unresolved: InteractionResolutionResult = { ...resolved, stringMappingStatus: "unresolved" };
    writeCache(key, unresolved);
    return unresolved;
  }

  const queryProtein = {
    stringId: match.stringId,
    preferredName: typeof match.preferredName === "string" ? match.preferredName : null,
    ncbiTaxonId: taxonId,
  };

  // Step 2: interaction partners
  let partnerRows: StringPartnerRow[];
  try {
    const rows = await fetchStringJson<StringPartnerRow[]>("interaction_partners", {
      identifiers: match.stringId,
      species: String(taxonId),
      required_score: String(minScore),
      limit: String(limit),
    });
    partnerRows = Array.isArray(rows) ? rows : [];
  } catch {
    return {
      ...resolved,
      stringMappingStatus: "resolved",
      queryProtein,
      availability: "source-failure",
      sourceStatus: "error",
    };
  }

  const partners = normalizePartners(partnerRows, match.stringId).slice(0, limit);
  const stringVersion = await getStringVersion();

  const result: InteractionResolutionResult = {
    ...resolved,
    stringMappingStatus: "resolved",
    availability: partners.length > 0 ? "available" : "none",
    sourceStatus: partners.length > 0 ? "success" : "empty",
    queryProtein,
    stringVersion,
    partners,
  };
  writeCache(key, result);
  return result;
}
