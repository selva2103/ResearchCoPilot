/**
 * lib/drug-target/extras.ts - Phase 5.10B
 *
 * Open Targets lookups for (a) gene tractability and (b) the indications of one drug.
 * Same failure discipline as 5.10A: transport or GraphQL failures return "source-failure"
 * and are NEVER cached. Unresolved, none and success are cached (per process, TTL, max entries).
 * ENSG and CHEMBL identifiers are validated by strict regexes before being placed in a query.
 */

import {
  ENSEMBL_HUMAN_GENE_RE,
  fetchOpenTargets,
  parseDataVersion,
} from "@/lib/drug-target/fetch";
import { stageRank } from "@/lib/drug-target/stages";
import type {
  DrugIndication,
  DrugIndicationsResult,
  TractabilityEntry,
  TractabilityResult,
} from "@/types/drug-target-extras";

export const CHEMBL_ID_RE = /^CHEMBL\d{1,12}$/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function makeCache<T>() {
  const map = new Map<string, { data: T; at: number }>();
  return {
    read(key: string): T | null {
      const e = map.get(key);
      if (!e) return null;
      if (Date.now() - e.at > CACHE_TTL_MS) {
        map.delete(key);
        return null;
      }
      return e.data;
    },
    write(key: string, data: T): void {
      if (map.size >= MAX_CACHE_ENTRIES && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, { data, at: Date.now() });
    },
  };
}

// -- tractability --------------------------------------------------------------

function tractabilityFailure(ensemblId: string): TractabilityResult {
  return { ensemblId, availability: "source-failure", dataVersion: null, assessedCount: 0, positives: [] };
}

/** Pure: maps a parsed Open Targets response body to a TractabilityResult. */
export function classifyTractabilityResponse(ensemblId: string, body: unknown): TractabilityResult {
  const failure = tractabilityFailure(ensemblId);
  const root = obj(body);
  if (!root || arr(root.errors).length > 0) return failure;
  const data = obj(root.data);
  if (!data) return failure;
  const dataVersion = parseDataVersion(data.meta);
  if (data.target === null) return { ...failure, availability: "unresolved", dataVersion };
  const target = obj(data.target);
  if (!target || !Array.isArray(target.tractability)) return failure;
  if (target.tractability.length === 0) return { ...failure, availability: "none", dataVersion };

  const entries: TractabilityEntry[] = [];
  for (const raw of target.tractability) {
    const e = obj(raw);
    const modality = str(e?.modality);
    const label = str(e?.label);
    if (!e || !modality || !label || typeof e.value !== "boolean") continue;
    entries.push({ modality, label, value: e.value });
  }
  if (entries.length === 0) return failure;
  return {
    ensemblId,
    availability: "available",
    dataVersion,
    assessedCount: entries.length,
    positives: entries.filter((x) => x.value),
  };
}

const tractabilityCache = makeCache<TractabilityResult>();

export function isTractabilityCached(ensemblId: string): boolean {
  return tractabilityCache.read(`tractability:${ensemblId}`) !== null;
}

export async function getTractabilityResult(ensemblId: string): Promise<TractabilityResult> {
  if (!ENSEMBL_HUMAN_GENE_RE.test(ensemblId)) {
    throw new Error("getTractabilityResult: invalid Ensembl gene ID");
  }
  const key = `tractability:${ensemblId}`;
  const cached = tractabilityCache.read(key);
  if (cached) return cached;
  const query =
    `{ target(ensemblId: "${ensemblId}") { id tractability { label value modality } } ` +
    `meta { dataVersion { year month iteration } } }`;
  let result: TractabilityResult;
  try {
    result = classifyTractabilityResponse(ensemblId, await fetchOpenTargets(query));
  } catch {
    result = tractabilityFailure(ensemblId);
  }
  if (result.availability !== "source-failure") tractabilityCache.write(key, result);
  return result;
}

// -- per-drug indications --------------------------------------------------------

function indicationsFailure(chemblId: string): DrugIndicationsResult {
  return { chemblId, availability: "source-failure", totalCount: 0, indications: [] };
}

/** Pure: maps a parsed Open Targets response body to a DrugIndicationsResult. */
export function classifyIndicationsResponse(chemblId: string, body: unknown): DrugIndicationsResult {
  const failure = indicationsFailure(chemblId);
  const root = obj(body);
  if (!root || arr(root.errors).length > 0) return failure;
  const data = obj(root.data);
  if (!data) return failure;
  if (data.drug === null) return { ...failure, availability: "unresolved" };
  const drug = obj(data.drug);
  if (!drug) return failure;
  if (drug.indications === null) return { ...failure, availability: "none" };
  const ind = obj(drug.indications);
  if (!ind || !Array.isArray(ind.rows)) return failure;
  if (ind.rows.length === 0) return { ...failure, availability: "none" };

  const indications: DrugIndication[] = [];
  for (const raw of ind.rows) {
    const row = obj(raw);
    const disease = obj(row?.disease);
    const diseaseName = str(disease?.name);
    if (!row || !disease || !diseaseName) continue;
    indications.push({ diseaseId: str(disease.id), diseaseName, stage: str(row.maxClinicalStage) });
  }
  if (indications.length === 0) return failure;
  indications.sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.diseaseName.localeCompare(b.diseaseName));
  const totalCount = typeof ind.count === "number" ? ind.count : indications.length;
  return { chemblId, availability: "available", totalCount, indications };
}

const indicationsCache = makeCache<DrugIndicationsResult>();

export function isIndicationsCached(chemblId: string): boolean {
  return indicationsCache.read(`indications:${chemblId}`) !== null;
}

export async function getDrugIndications(chemblId: string): Promise<DrugIndicationsResult> {
  if (!CHEMBL_ID_RE.test(chemblId)) {
    throw new Error("getDrugIndications: invalid ChEMBL ID");
  }
  const key = `indications:${chemblId}`;
  const cached = indicationsCache.read(key);
  if (cached) return cached;
  const query =
    `{ drug(chemblId: "${chemblId}") { id indications { count rows { maxClinicalStage disease { id name } } } } }`;
  let result: DrugIndicationsResult;
  try {
    result = classifyIndicationsResponse(chemblId, await fetchOpenTargets(query));
  } catch {
    result = indicationsFailure(chemblId);
  }
  if (result.availability !== "source-failure") indicationsCache.write(key, result);
  return result;
}
