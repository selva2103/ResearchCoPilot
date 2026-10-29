/**
 * lib/protein/structure-fetch.ts — Phase 5.8A
 *
 * ProteinStructureService — AlphaFold DB + RCSB PDB structure retrieval
 * ──────────────────────────────────────────────────────────────────
 * Consumes a resolved UniProt accession from ProteinIdentifierResolver —
 * NEVER calls the UniProt mapping API itself. That separation is enforced by
 * requiring a ProteinIdentifierMapping as input, exactly like ProteinDomainService.
 *
 * TWO INDEPENDENT SOURCES (Section 2 / Section 6):
 *   AlphaFold DB (predicted) and RCSB PDB (experimental) are queried and
 *   fail INDEPENDENTLY. A failure in one source NEVER suppresses or
 *   contaminates the other's result. This is the single most important new
 *   architectural rule in this phase.
 *
 * CARDINALITY (Section 1):
 *   Neither source is 1:1. AlphaFold may return 0–N models (isoforms/fragments).
 *   RCSB routinely returns 0–N entries, each with 0–N matching polymer entities.
 *   No fixed-cardinality assumption anywhere.
 *
 * PDB ENTITY/INSTANCE PRECISION (Section 3):
 *   A PDB entry is NOT a single structure. We resolve the specific polymer
 *   entity (entityId) and chain (instanceId) that corresponds to the resolved
 *   UniProt protein, using RCSB's authoritative container identifiers/alignment
 *   (SIFTS) — never naive residue-number diffing.
 *
 * COVERAGE (Section 3):
 *   Coverage comes from RCSB's authoritative mapping
 *   (rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers
 *   .reference_sequence_coverage and rcsb_polymer_entity_align.aligned_regions),
 *   NOT from diffing raw residue numbers.
 *
 * DETERMINISTIC RANKING (Section 3), implemented as a pure exported function:
 *   coverage fraction → resolution → deposition/release date → stable id.
 *
 * CACHING (Section 7) — fully independent per source:
 *   structure-alphafold:{proteinAccession}   (RefSeq key)
 *   structure-pdb:{proteinAccession}         (RefSeq key)
 *   TTL 24h. Expiry/failure of one never affects the other.
 *
 * SECURITY (Section 4):
 *   fileUrl is ALWAYS backend-constructed from an allowlisted host template.
 *   Upstream URL strings are NEVER passed through.
 *
 * NEW EXTERNAL HOSTS (independent rate limiters):
 *   www.alphafold.ebi.ac.uk (AlphaFold DB)
 *   search.rcsb.org / data.rcsb.org / files.rcsb.org (RCSB PDB)
 */

import { fetchWithRetry as baseFetchWithRetry } from "@/lib/utils";
import type { ProteinIdentifierMapping } from "@/types/protein-domain";
import type {
  ProteinStructure,
  StructureResolutionResult,
  StructureSourceStatus,
} from "@/types/protein-structure";

// ── Allowlist of structure-file static hosts (Section 4 security rule) ────────
// Structured as hostname sets so a validation helper can be explicit about the
// security boundary. Only these hosts may ever appear in `fileUrl`.

const ALPHAFOLD_FILE_HOST = "alphafold.ebi.ac.uk";
const RCSB_FILE_HOST = "files.rcsb.org";

const ALPHAFOLD_API_BASE = "https://www.alphafold.ebi.ac.uk";
const RCSB_SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query";
const RCSB_GRAPHQL_URL = "https://data.rcsb.org/graphql";

// ── In-memory caches (two fully independent Maps) ─────────────────────────────

// Local wrapper: adds an overall timeout (covers retries) so a stalled upstream
// cannot hang the request. Other modules keep using the shared fetchWithRetry.
const STRUCTURE_FETCH_TIMEOUT_MS = 25000;
function fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
  return baseFetchWithRetry(url, {
    ...options,
    signal: AbortSignal.timeout(STRUCTURE_FETCH_TIMEOUT_MS),
  });
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: ProteinStructure[];
  fetchedAt: number;
}

const alphaFoldCache = new Map<string, CacheEntry>();
const pdbCache = new Map<string, CacheEntry>();

function buildAlphaFoldCacheKey(proteinAccession: string): string {
  return `structure-alphafold:${proteinAccession}`;
}
function buildPdbCacheKey(proteinAccession: string): string {
  return `structure-pdb:${proteinAccession}`;
}

function readCache(cache: Map<string, CacheEntry>, key: string): ProteinStructure[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache(cache: Map<string, CacheEntry>, key: string, data: ProteinStructure[]): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

export function isAlphaFoldStructureCached(proteinAccession: string): boolean {
  return readCache(alphaFoldCache, buildAlphaFoldCacheKey(proteinAccession)) !== null;
}
export function isPdbStructureCached(proteinAccession: string): boolean {
  return readCache(pdbCache, buildPdbCacheKey(proteinAccession)) !== null;
}

// ── Independent rate limiters ─────────────────────────────────────────────────

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

const withAlphaFoldLimit = makeLimiter(200);
const withRcsbLimit = makeLimiter(150);

// ── fileUrl construction (backend-constructed, allowlisted) ───────────────────
// Never passthrough of an upstream URL string. Templates are fixed against
// the allowlisted hosts above.

function buildAlphaFoldFileUrl(modelEntityId: string, latestVersion: number): string {
  return `https://${ALPHAFOLD_FILE_HOST}/files/${modelEntityId}-model_v${latestVersion}.cif`;
}

function buildPdbFileUrl(entryId: string): string {
  return `https://${RCSB_FILE_HOST}/download/${entryId}.cif`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pure deterministic ranking (Section 3)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sort keys needed for deterministic PDB ranking, carried on an internal
 * candidate view (deposition date is not part of the ProteinStructure
 * contract, so it lives only here for ranking before being stripped).
 */
export interface PdbRankKey {
  sourceId: string;
  entityId: string | null;
  instanceId: string | null;
  coverageFraction: number | null;
  resolution: number | null;
  /** Reversed/release date ISO string (e.g. "1998-04-08T00:00:00Z"); null when unknown. */
  depositDate: string | null;
}

function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Descending, null last (numbers).
function descNumNullLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

// Ascending, null last (numbers — "lower is better" for resolution).
function ascNumNullLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

// Descending, null last (ISO date strings — "most recent first").
function descDateNullLast(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmpStr(b, a);
}

/**
 * Deterministic PDB ranking, exactly per Section 3:
 *   1. coverage fraction (higher first)
 *   2. resolution (lower/better first)
 *   3. deposition/release date (most recent first)
 *   4. stable sourceId → entityId → instanceId tiebreaker
 *
 * Stable and reproducible: equal inputs always produce identical output order.
 */
export function rankPdbStructures<T extends PdbRankKey>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const cov = descNumNullLast(a.coverageFraction, b.coverageFraction);
    if (cov !== 0) return cov;
    const res = ascNumNullLast(a.resolution, b.resolution);
    if (res !== 0) return res;
    const date = descDateNullLast(a.depositDate, b.depositDate);
    if (date !== 0) return date;
    const byId = cmpStr(a.sourceId, b.sourceId);
    if (byId !== 0) return byId;
    const byEntity = cmpStr(a.entityId ?? "", b.entityId ?? "");
    if (byEntity !== 0) return byEntity;
    return cmpStr(a.instanceId ?? "", b.instanceId ?? "");
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AlphaFold DB integration (predicted)
// ═══════════════════════════════════════════════════════════════════════════════

// Only current field names from Section 1.1 are consumed. Extra/unrecognized
// fields are ignored defensively (schema has drifted before).
interface AlphaFoldResponseEntry {
  modelEntityId?: string;
  sequenceStart?: number;
  sequenceEnd?: number;
  latestVersion?: number;
  globalMetricValue?: number;
}

async function fetchAlphaFoldRecords(uniprotAccession: string): Promise<AlphaFoldResponseEntry[]> {
  const url = `${ALPHAFOLD_API_BASE}/api/prediction/${encodeURIComponent(uniprotAccession)}`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": "ResearchCoPilot/1.0" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 — AlphaFold DB rate limit hit");
    throw new Error(`AlphaFold API HTTP ${res.status} for ${uniprotAccession}`);
  }

  const json: unknown = await res.json();

  // Defensive normalization: the endpoint may return an array (current) or a
  // single object (some historical/dataset variants).
  if (Array.isArray(json)) return json as AlphaFoldResponseEntry[];
  if (json && typeof json === "object") return [json as AlphaFoldResponseEntry];
  return [];
}

function normalizeAlphaFold(
  entries: AlphaFoldResponseEntry[],
  proteinAccession: string,
  uniprotAccession: string,
  geneId: string,
  organism: string
): ProteinStructure[] {
  const results: ProteinStructure[] = [];

  for (const entry of entries) {
    // A record without a model entity id cannot be identified or have its
    // file URL constructed — skip individually rather than crash (5.7A discipline).
    if (!entry?.modelEntityId) continue;

    const latestVersion = typeof entry.latestVersion === "number" ? entry.latestVersion : 1;

    results.push({
      sourceId: entry.modelEntityId,
      sourceType: "predicted",
      sourceDatabase: "alphafold",
      entityId: null,
      instanceId: null,
      method: null,
      resolution: null,
      confidenceScore: typeof entry.globalMetricValue === "number" ? entry.globalMetricValue : null,
      coverageStart: typeof entry.sequenceStart === "number" ? entry.sequenceStart : null,
      coverageEnd: typeof entry.sequenceEnd === "number" ? entry.sequenceEnd : null,
      coverageFraction: null,
      fileUrl: buildAlphaFoldFileUrl(entry.modelEntityId, latestVersion),
      proteinAccession,
      uniprotAccession,
      geneId,
      organism,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RCSB PDB integration (experimental)
// ═══════════════════════════════════════════════════════════════════════════════

interface RcsbSearchResponse {
  total_count?: number;
  result_set?: { identifier: string; score?: number }[];
}

interface RcsbReferenceSequenceIdentifier {
  database_accession?: string;
  database_name?: string;
  reference_sequence_coverage?: number;
}

interface RcsbAlignedRegion {
  entity_beg_seq_id?: number;
  ref_beg_seq_id?: number;
  length?: number;
}

interface RcsbPolymerEntity {
  rcsb_id?: string;
  rcsb_polymer_entity_container_identifiers?: {
    entry_id?: string;
    entity_id?: string;
    asym_ids?: string[];
    reference_sequence_identifiers?: RcsbReferenceSequenceIdentifier[];
  };
  rcsb_polymer_entity_align?: {
    reference_database_accession?: string;
    aligned_regions?: RcsbAlignedRegion[];
  }[];
}

interface RcsbGraphQlEntityResponse {
  data?: { polymer_entities?: RcsbPolymerEntity[] };
  errors?: { message?: string }[];
}

interface RcsbEntry {
  rcsb_id?: string;
  exptl?: { method?: string }[];
  rcsb_entry_info?: {
    experimental_method?: string | null;
    diffrn_resolution_high?: { value?: number } | null;
    resolution_combined?: number[] | null;
  };
  rcsb_accession_info?: {
    deposit_date?: string;
    initial_release_date?: string;
  };
}

interface RcsbGraphQlEntriesResponse {
  data?: { entries?: RcsbEntry[] };
  errors?: { message?: string }[];
}

/** Search for every polymer entity mapped to the resolved UniProt accession. */
async function searchPdbEntities(uniprotAccession: string): Promise<string[]> {
  const body = {
    query: {
      type: "terminal",
      service: "text",
      parameters: {
        attribute:
          "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
        operator: "exact_match",
        value: uniprotAccession,
      },
    },
    return_type: "polymer_entity",
    request_options: { return_all_hits: true },
  };

  const res = await fetchWithRetry(RCSB_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 — RCSB search rate limit hit");
    throw new Error(`RCSB search HTTP ${res.status} for ${uniprotAccession}`);
  }

  const json = (await res.json()) as RcsbSearchResponse;
  return (json.result_set ?? []).map((r) => r.identifier).filter(Boolean);
}

async function fetchPdbEntities(entityIds: string[]): Promise<RcsbPolymerEntity[]> {
  if (entityIds.length === 0) return [];

  const results: RcsbPolymerEntity[] = [];
  // Chunk to be polite to the GraphQL endpoint.
  const CHUNK = 100;
  for (let i = 0; i < entityIds.length; i += CHUNK) {
    const slice = entityIds.slice(i, i + CHUNK);
    const query = `{ polymer_entities(entity_ids: ${JSON.stringify(slice)}) { rcsb_id rcsb_polymer_entity_container_identifiers { entry_id entity_id asym_ids reference_sequence_identifiers { database_accession database_name reference_sequence_coverage } } rcsb_polymer_entity_align { reference_database_accession aligned_regions { entity_beg_seq_id ref_beg_seq_id length } } } }`;

    const res = await fetchWithRetry(RCSB_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      throw new Error(`RCSB GraphQL (entities) HTTP ${res.status}`);
    }

    const json = (await res.json()) as RcsbGraphQlEntityResponse;
    if (json.errors && json.errors.length > 0) {
      throw new Error(`RCSB GraphQL (entities) error: ${json.errors[0]?.message ?? "unknown"}`);
    }
    results.push(...(json.data?.polymer_entities ?? []));
  }
  return results;
}

async function fetchPdbEntries(entryIds: string[]): Promise<Map<string, RcsbEntry>> {
  const map = new Map<string, RcsbEntry>();
  if (entryIds.length === 0) return map;

  const CHUNK = 100;
  for (let i = 0; i < entryIds.length; i += CHUNK) {
    const slice = entryIds.slice(i, i + CHUNK);
    const query = `{ entries(entry_ids: ${JSON.stringify(slice)}) { rcsb_id exptl { method } rcsb_entry_info { experimental_method diffrn_resolution_high { value } resolution_combined } rcsb_accession_info { deposit_date initial_release_date } } }`;

    const res = await fetchWithRetry(RCSB_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      throw new Error(`RCSB GraphQL (entries) HTTP ${res.status}`);
    }

    const json = (await res.json()) as RcsbGraphQlEntriesResponse;
    if (json.errors && json.errors.length > 0) {
      throw new Error(`RCSB GraphQL (entries) error: ${json.errors[0]?.message ?? "unknown"}`);
    }
    for (const e of json.data?.entries ?? []) {
      if (e.rcsb_id) map.set(e.rcsb_id, e);
    }
  }
  return map;
}

/** Find the reference-sequence identifier / alignment matching the target accession. */
function findReferenceIdent(
  entity: RcsbPolymerEntity,
  uniprotAccession: string
): RcsbReferenceSequenceIdentifier | null {
  const ids = entity.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers ?? [];
  for (const id of ids) {
    if (id.database_accession === uniprotAccession) return id;
  }
  return null;
}

function findAlign(
  entity: RcsbPolymerEntity,
  uniprotAccession: string
): { ref_beg_seq_id?: number; length?: number }[] | null {
  const aligns = entity.rcsb_polymer_entity_align ?? [];
  for (const a of aligns) {
    if (a.reference_database_accession === uniprotAccession) return a.aligned_regions ?? [];
  }
  return null;
}

interface PdbCandidate extends PdbRankKey {
  structure: ProteinStructure;
}

/**
 * Normalize raw RCSB entity + entry data into PdbCandidate[] (rankable views),
 * resolving entity/chain and authoritative coverage. Malformed entities are
 * skipped individually — never crashing the whole source.
 */
function normalizePdb(
  entities: RcsbPolymerEntity[],
  entryMap: Map<string, RcsbEntry>,
  proteinAccession: string,
  uniprotAccession: string,
  geneId: string,
  organism: string
): PdbCandidate[] {
  const candidates: PdbCandidate[] = [];

  for (const entity of entities) {
    const ids = entity.rcsb_polymer_entity_container_identifiers;
    const entryId = ids?.entry_id;
    const entityId = ids?.entity_id;
    if (!entryId || !entityId) continue; // malformed — skip individually

    const refIdent = findReferenceIdent(entity, uniprotAccession);
    // If this entity does not actually map to the target accession, skip it.
    if (!refIdent) continue;

    const coverageFraction =
      typeof refIdent.reference_sequence_coverage === "number"
        ? refIdent.reference_sequence_coverage
        : null;

    // Authoritative coverage range (UniProt numbering) from aligned_regions.
    const regions = findAlign(entity, uniprotAccession);
    let coverageStart: number | null = null;
    let coverageEnd: number | null = null;
    if (regions && regions.length > 0) {
      const valid = regions.filter(
        (r) => typeof r.ref_beg_seq_id === "number" && typeof r.length === "number"
      );
      if (valid.length > 0) {
        const starts = valid.map((r) => r.ref_beg_seq_id as number);
        const ends = valid.map((r) => (r.ref_beg_seq_id as number) + (r.length as number) - 1);
        coverageStart = Math.min(...starts);
        coverageEnd = Math.max(...ends);
      }
    }

    const asymIds = ids.asym_ids ?? [];
    const instanceId = asymIds.length > 0 ? asymIds[0] : null;

    const entry = entryMap.get(entryId);
    const method = entry?.exptl?.[0]?.method ?? entry?.rcsb_entry_info?.experimental_method ?? null;

    // Resolution: prefer the combined resolution (covers X-ray, cryo-EM, NMR,
    // neutron), fall back to the crystallographic diffrn high value.
    const combined = entry?.rcsb_entry_info?.resolution_combined;
    const resolution =
      combined && combined.length > 0 && typeof combined[0] === "number"
        ? combined[0]
        : entry?.rcsb_entry_info?.diffrn_resolution_high?.value &&
            typeof entry.rcsb_entry_info.diffrn_resolution_high.value === "number"
          ? entry.rcsb_entry_info.diffrn_resolution_high.value
          : null;
    const depositDate =
      entry?.rcsb_accession_info?.initial_release_date ??
      entry?.rcsb_accession_info?.deposit_date ??
      null;

    const structure: ProteinStructure = {
      sourceId: entryId,
      sourceType: "experimental",
      sourceDatabase: "pdb",
      entityId,
      instanceId,
      method,
      resolution,
      confidenceScore: null,
      coverageStart,
      coverageEnd,
      coverageFraction,
      fileUrl: buildPdbFileUrl(entryId),
      proteinAccession,
      uniprotAccession,
      geneId,
      organism,
    };

    candidates.push({
      sourceId: entryId,
      entityId,
      instanceId,
      coverageFraction,
      resolution,
      depositDate,
      structure,
    });
  }

  return candidates;
}

/**
 * Retrieve + rank experimental PDB structures for a resolved UniProt accession.
 * Returns sorted ProteinStructure[] (coverage→resolution→date→id).
 */
async function fetchRankedPdb(
  uniprotAccession: string,
  proteinAccession: string,
  geneId: string,
  organism: string
): Promise<ProteinStructure[]> {
  const entityIds = await searchPdbEntities(uniprotAccession);
  if (entityIds.length === 0) return [];

  const entities = await fetchPdbEntities(entityIds);
  if (entities.length === 0) return [];

  const entryIds = Array.from(
    new Set(
      entities
        .map((e) => e.rcsb_polymer_entity_container_identifiers?.entry_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const entryMap = await fetchPdbEntries(entryIds);

  const candidates = normalizePdb(entities, entryMap, proteinAccession, uniprotAccession, geneId, organism);
  const ranked = rankPdbStructures(candidates);
  return ranked.map((c) => c.structure);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Per-source public fetchers (independent caching)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch AlphaFold (predicted) structures. Throws on upstream error.
 * Cached independently under structure-alphafold:{proteinAccession}.
 */
async function getAlphaFoldStructures(
  uniprotAccession: string,
  proteinAccession: string,
  geneId: string,
  organism: string
): Promise<ProteinStructure[]> {
  const key = buildAlphaFoldCacheKey(proteinAccession);
  const cached = readCache(alphaFoldCache, key);
  if (cached !== null) return cached;

  return withAlphaFoldLimit(async () => {
    const postWait = readCache(alphaFoldCache, key);
    if (postWait !== null) return postWait;

    const entries = await fetchAlphaFoldRecords(uniprotAccession);
    const structures = normalizeAlphaFold(entries, proteinAccession, uniprotAccession, geneId, organism);
    writeCache(alphaFoldCache, key, structures);
    return structures;
  });
}

/**
 * Fetch + rank experimental PDB structures. Throws on upstream error.
 * Cached independently under structure-pdb:{proteinAccession}.
 */
async function getPdbStructures(
  uniprotAccession: string,
  proteinAccession: string,
  geneId: string,
  organism: string
): Promise<ProteinStructure[]> {
  const key = buildPdbCacheKey(proteinAccession);
  const cached = readCache(pdbCache, key);
  if (cached !== null) return cached;

  return withRcsbLimit(async () => {
    const postWait = readCache(pdbCache, key);
    if (postWait !== null) return postWait;

    const structures = await fetchRankedPdb(uniprotAccession, proteinAccession, geneId, organism);
    writeCache(pdbCache, key, structures);
    return structures;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Resolution result assembly (Section 6)
// ═══════════════════════════════════════════════════════════════════════════════

function computeAvailability(
  statuses: { alphafold: StructureSourceStatus; pdb: StructureSourceStatus },
  structureCount: number
): StructureResolutionResult["structureAvailability"] {
  if (structureCount > 0) return "available";

  const a = statuses.alphafold;
  const p = statuses.pdb;

  if (a === "error" && p === "error") return "source-failure";
  if (a === "error" || p === "error") return "partial-source-failure";
  return "none";
}

/**
 * Resolve structures for a protein, consuming the already-resolved mapping.
 *
 * Independent-failure model (Section 6): AlphaFold and RCSB are queried
 * independently; a failure in one never suppresses the other's result.
 *
 * @returns StructureResolutionResult. When the mapping is not "resolved",
 *          identifierStatus is "unresolved" and BOTH source statuses are
 *          "not-attempted" (no lookup was attempted).
 */
export async function getProteinStructureResult(
  mapping: ProteinIdentifierMapping,
  geneId: string,
  organism: string
): Promise<StructureResolutionResult> {
  const { refseqAccession, uniprotAccession } = mapping;

  // ── Not resolved (unresolved OR ambiguous): no lookup attempted ──────────────
  if (mapping.resolutionStatus !== "resolved" || !uniprotAccession) {
    return {
      identifierStatus: "unresolved",
      structureAvailability: "none",
      sourceStatuses: { alphafold: "not-attempted", pdb: "not-attempted" },
      structures: [],
    };
  }

  // ── Query both sources independently ─────────────────────────────────────────
  const [alphaFoldResult, pdbResult] = await Promise.all([
    getAlphaFoldStructures(uniprotAccession, refseqAccession, geneId, organism)
      .catch((e) => {
        console.error("[structure] AlphaFold source failed:", e instanceof Error ? e.message : e);
        throw e;
      })
      .then((structs): { status: StructureSourceStatus; structs: ProteinStructure[] } => ({
        status: structs.length > 0 ? "success" : "empty",
        structs,
      }))
      .catch((): { status: StructureSourceStatus; structs: ProteinStructure[] } => ({
        status: "error",
        structs: [],
      })),
    getPdbStructures(uniprotAccession, refseqAccession, geneId, organism)
      .catch((e) => {
        console.error("[structure] PDB source failed:", e instanceof Error ? e.message : e);
        throw e;
      })
      .then((structs): { status: StructureSourceStatus; structs: ProteinStructure[] } => ({
        status: structs.length > 0 ? "success" : "empty",
        structs,
      }))
      .catch((): { status: StructureSourceStatus; structs: ProteinStructure[] } => ({
        status: "error",
        structs: [],
      })),
  ]);

  const sourceStatuses = {
    alphafold: alphaFoldResult.status,
    pdb: pdbResult.status,
  };

  // PDB structures are already ranked within getPdbStructures; AlphaFold records
  // are surfaced after them (experimental primary per Section 2).
  const structures: ProteinStructure[] = [...pdbResult.structs, ...alphaFoldResult.structs];

  return {
    identifierStatus: "resolved",
    structureAvailability: computeAvailability(sourceStatuses, structures.length),
    sourceStatuses,
    structures,
  };
}