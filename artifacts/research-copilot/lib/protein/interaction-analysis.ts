/**
 * lib/protein/interaction-analysis.ts
 *
 * STRING network statistics (ppi_enrichment) and GO Biological Process enrichment
 * (enrichment, category "Process") for a set of STRING IDs. Uses the same serialized
 * STRING limiter as interaction-fetch.ts. Failures are reported, never invented, and
 * only fully successful results are cached.
 */

import { fetchStringJson, getStringVersion } from "@/lib/protein/interaction-fetch";
import type {
  InteractionAnalysisResult,
  InteractionEnrichmentTerm,
  InteractionNetworkStats,
} from "@/types/protein-interaction-analysis";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TERMS = 8;
const MAX_FDR = "0.05";

interface PpiRow {
  number_of_nodes?: number | string;
  number_of_edges?: number | string;
  average_node_degree?: number | string;
  local_clustering_coefficient?: number | string;
  expected_number_of_edges?: number | string;
  p_value?: number | string;
}

interface EnrichRow {
  category?: string;
  term?: string;
  description?: string;
  number_of_genes?: number | string;
  number_of_genes_in_background?: number | string;
  fdr?: number | string;
  strength?: number | string;
  signal?: number | string;
}

const cache = new Map<string, { at: number; data: InteractionAnalysisResult }>();

function readCache(key: string): InteractionAnalysisResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function num(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseStats(row: PpiRow | undefined): InteractionNetworkStats | null {
  if (!row) return null;
  const nodes = num(row.number_of_nodes);
  const edges = num(row.number_of_edges);
  const degree = num(row.average_node_degree);
  const clustering = num(row.local_clustering_coefficient);
  const expected = num(row.expected_number_of_edges);
  const p = num(row.p_value);
  if (nodes === null || edges === null || degree === null || clustering === null || expected === null || p === null) {
    return null;
  }
  return {
    numberOfNodes: nodes,
    numberOfEdges: edges,
    averageNodeDegree: degree,
    localClusteringCoefficient: clustering,
    expectedNumberOfEdges: expected,
    pValue: p,
  };
}

function parseTerm(row: EnrichRow): InteractionEnrichmentTerm | null {
  const term = typeof row.term === "string" ? row.term : "";
  const description = typeof row.description === "string" ? row.description : "";
  const inNetwork = num(row.number_of_genes);
  const inBackground = num(row.number_of_genes_in_background);
  const fdr = num(row.fdr);
  if (!term || !description || inNetwork === null || inBackground === null || fdr === null) return null;
  return {
    term,
    description,
    genesInNetwork: inNetwork,
    genesInBackground: inBackground,
    fdr,
    strength: num(row.strength),
    signal: num(row.signal),
  };
}

export async function getInteractionAnalysis(
  stringIds: string[],
  taxonId: number,
  minScore: number
): Promise<InteractionAnalysisResult> {
  const ids = Array.from(new Set(stringIds));
  const key = `analysis-string:${taxonId}:${minScore}:${[...ids].sort().join(",")}`;
  const cached = readCache(key);
  if (cached) return cached;

  const identifiers = ids.join("\n");
  const species = String(taxonId);

  let stats: InteractionNetworkStats | null = null;
  try {
    const rows = await fetchStringJson<PpiRow[]>("ppi_enrichment", {
      identifiers,
      species,
      required_score: String(minScore),
    });
    stats = parseStats(Array.isArray(rows) ? rows[0] : undefined);
  } catch {
    stats = null;
  }

  let goProcess: InteractionEnrichmentTerm[] = [];
  let enrichmentStatus: InteractionAnalysisResult["enrichmentStatus"] = "error";
  try {
    const rows = await fetchStringJson<EnrichRow[]>("enrichment", {
      identifiers,
      species,
      add_scores: "1",
      max_fdr: MAX_FDR,
    });
    const list = Array.isArray(rows) ? rows : [];
    goProcess = list
      .filter((r) => r.category === "Process")
      .map(parseTerm)
      .filter((t): t is InteractionEnrichmentTerm => t !== null)
      .sort((a, b) => (b.signal ?? -1) - (a.signal ?? -1) || a.fdr - b.fdr)
      .slice(0, MAX_TERMS);
    enrichmentStatus = goProcess.length > 0 ? "success" : "empty";
  } catch {
    goProcess = [];
    enrichmentStatus = "error";
  }

  const statsStatus: InteractionAnalysisResult["statsStatus"] = stats ? "success" : "error";
  const failures = (statsStatus === "error" ? 1 : 0) + (enrichmentStatus === "error" ? 1 : 0);
  const sourceStatus: InteractionAnalysisResult["sourceStatus"] =
    failures === 2 ? "error" : failures === 1 ? "partial" : "success";

  const result: InteractionAnalysisResult = {
    sourceStatus,
    statsStatus,
    enrichmentStatus,
    stringVersion: await getStringVersion(),
    proteinCount: ids.length,
    minScore,
    stats,
    goProcess,
  };
  if (sourceStatus === "success") cache.set(key, { at: Date.now(), data: result });
  return result;
}
