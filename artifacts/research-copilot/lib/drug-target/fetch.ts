/**
 * lib/drug-target/fetch.ts - Phase 5.10A
 *
 * Open Targets Platform GraphQL lookup of drugs and clinical candidates for one human gene.
 *
 * Failure design (same discipline as 5.9): any transport or GraphQL failure returns
 * availability "source-failure" and is NEVER cached. Only success, empty (no candidates)
 * and unresolved (unknown Ensembl ID) are cached. The cache is per process, with a TTL
 * and a maximum number of entries.
 */

import { fetchWithRetry } from "@/lib/utils";
import { stageRank } from "@/lib/drug-target/stages";
import { UNIPROT_ACCESSION_RE, parseCrossReferences } from "@/lib/drug-target/links";
import type { DrugCandidate, DrugMechanism, DrugTargetResult } from "@/types/drug-target";

const OPEN_TARGETS_URL = "https://api.platform.opentargets.org/api/v4/graphql";
export const ENSEMBL_HUMAN_GENE_RE = /^ENSG\d{11}$/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const FETCH_TIMEOUT_MS = 25000;
const REQUEST_SPACING_MS = 250;

// -- limiter ------------------------------------------------------------------

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

const withOpenTargetsLimit = makeLimiter(REQUEST_SPACING_MS);

// -- query --------------------------------------------------------------------

function buildQuery(ensemblId: string): string {
  // The ID is interpolated as a literal, so it must have passed the strict regex.
  if (!ENSEMBL_HUMAN_GENE_RE.test(ensemblId)) {
    throw new Error("buildQuery: invalid Ensembl gene ID");
  }
  return (
    `{ target(ensemblId: "${ensemblId}") { id approvedSymbol proteinIds { id source } ` +
    `drugAndClinicalCandidates { count rows { maxClinicalStage ` +
    `drug { id name drugType maximumClinicalStage crossReferences { source ids } ` +
    `mechanismsOfAction { rows { mechanismOfAction actionType targetName } } } } } } ` +
    `meta { dataVersion { year month iteration } } }`
  );
}

// -- response parsing (pure) ---------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function parseDataVersion(meta: unknown): string | null {
  const dv = obj(obj(meta)?.dataVersion);
  if (!dv) return null;
  const year = str(dv.year);
  const month = str(dv.month);
  if (!year || !month) return null;
  const iteration = str(dv.iteration);
  return iteration ? `${year}.${month}.${iteration}` : `${year}.${month}`;
}

function failureResult(ensemblId: string): DrugTargetResult {
  return {
    ensemblId,
    approvedSymbol: null,
    availability: "source-failure",
    sourceStatus: "error",
    dataVersion: null,
    totalCount: 0,
    candidates: [],
  };
}

/** Pure: maps a parsed Open Targets GraphQL response body to a DrugTargetResult. */
function classifyCore(ensemblId: string, body: unknown): DrugTargetResult {
  const failure = failureResult(ensemblId);
  const root = obj(body);
  if (!root) return failure;
  if (arr(root.errors).length > 0) return failure;
  const data = obj(root.data);
  if (!data) return failure;
  const dataVersion = parseDataVersion(data.meta);

  // An explicit null target means Open Targets does not know this ID.
  if (data.target === null) {
    return { ...failure, availability: "unresolved", sourceStatus: "empty", dataVersion };
  }
  const target = obj(data.target);
  if (!target) return failure;
  const approvedSymbol = str(target.approvedSymbol);

  if (target.drugAndClinicalCandidates === null) {
    return { ...failure, approvedSymbol, availability: "none", sourceStatus: "empty", dataVersion };
  }
  const dc = obj(target.drugAndClinicalCandidates);
  if (!dc) return failure;
  const rows = dc.rows;
  if (!Array.isArray(rows)) return failure;
  if (rows.length === 0) {
    return { ...failure, approvedSymbol, availability: "none", sourceStatus: "empty", dataVersion };
  }

  const candidates: DrugCandidate[] = [];
  for (const raw of rows) {
    const row = obj(raw);
    const drug = obj(row?.drug);
    if (!row || !drug) continue;
    const chemblId = str(drug.id);
    const name = str(drug.name);
    if (!chemblId || !name) continue;
    const mechanisms: DrugMechanism[] = [];
    for (const m of arr(obj(drug.mechanismsOfAction)?.rows)) {
      const mo = obj(m);
      const text = str(mo?.mechanismOfAction);
      if (!mo || !text) continue;
      mechanisms.push({
        mechanismOfAction: text,
        actionType: str(mo.actionType),
        targetName: str(mo.targetName),
      });
    }
    candidates.push({
      chemblId,
      name,
      drugType: str(drug.drugType),
      rowStage: str(row.maxClinicalStage),
      drugStage: str(drug.maximumClinicalStage),
      mechanisms,
    });
  }
  // Rows existed but none were usable: that is a malformed response, not "none".
  if (candidates.length === 0) return failure;

  candidates.sort((a, b) => stageRank(a.rowStage) - stageRank(b.rowStage) || a.name.localeCompare(b.name));
  const totalCount = typeof dc.count === "number" ? dc.count : candidates.length;
  return {
    ensemblId,
    approvedSymbol,
    availability: "available",
    sourceStatus: "success",
    dataVersion,
    totalCount,
    candidates,
  };
}

/**
 * Pure: classifyCore plus the link data added in 5.10C (the target's reviewed UniProt accession and
 * each drug's DrugBank / Probes&Drugs IDs). All IDs are validated by regex; a missing ID stays empty.
 */
export function classifyOpenTargetsResponse(ensemblId: string, body: unknown): DrugTargetResult {
  const base = classifyCore(ensemblId, body);
  if (base.availability === "source-failure") return base;
  const target = obj(obj(obj(body)?.data)?.target);

  let uniprotId: string | null = null;
  for (const p of arr(target?.proteinIds)) {
    const rec = obj(p);
    const id = str(rec?.id);
    if (str(rec?.source) === "uniprot_swissprot" && id && UNIPROT_ACCESSION_RE.test(id)) {
      uniprotId = id;
      break;
    }
  }

  const xrefs = new Map<string, { drugbankIds: string[]; probesDrugsIds: string[] }>();
  for (const raw of arr(obj(target?.drugAndClinicalCandidates)?.rows)) {
    const drug = obj(obj(raw)?.drug);
    const id = str(drug?.id);
    if (drug && id) xrefs.set(id, parseCrossReferences(drug.crossReferences));
  }

  return {
    ...base,
    uniprotId,
    candidates: base.candidates.map((c) => ({
      ...c,
      ...(xrefs.get(c.chemblId) ?? { drugbankIds: [], probesDrugsIds: [] }),
    })),
  };
}

// -- cache --------------------------------------------------------------------

interface CacheEntry {
  data: DrugTargetResult;
  fetchedAt: number;
}
const resultCache = new Map<string, CacheEntry>();

function cacheKey(ensemblId: string): string {
  return `drug-target:${ensemblId}`;
}

function readCache(key: string): DrugTargetResult | null {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache(key: string, data: DrugTargetResult): void {
  if (resultCache.size >= MAX_CACHE_ENTRIES && !resultCache.has(key)) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }
  resultCache.set(key, { data, fetchedAt: Date.now() });
}

export function isDrugTargetCached(ensemblId: string): boolean {
  return readCache(cacheKey(ensemblId)) !== null;
}

// -- public entry point -------------------------------------------------------

export async function fetchOpenTargets(query: string): Promise<unknown> {
  return withOpenTargetsLimit(async () => {
    const res = await fetchWithRetry(OPEN_TARGETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Open Targets`);
    return await res.json();
  });
}

export async function getDrugTargetResult(ensemblId: string): Promise<DrugTargetResult> {
  if (!ENSEMBL_HUMAN_GENE_RE.test(ensemblId)) {
    throw new Error("getDrugTargetResult: invalid Ensembl gene ID");
  }
  const key = cacheKey(ensemblId);
  const cached = readCache(key);
  if (cached) return cached;

  let result: DrugTargetResult;
  try {
    const body = await fetchOpenTargets(buildQuery(ensemblId));
    result = classifyOpenTargetsResponse(ensemblId, body);
  } catch {
    result = failureResult(ensemblId);
  }
  if (result.sourceStatus !== "error") writeCache(key, result);
  return result;
}
