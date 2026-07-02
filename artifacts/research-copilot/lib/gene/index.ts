/**
 * lib/gene/index.ts — Gene Explorer module orchestrator (Phase 5.2)
 *
 * Public API: searchGeneExplorer(query, options) → ModuleResult<GeneRecord>
 *
 * Resolution pipeline (Step 3):
 *
 *   Case A — HIGH confidence Gene from resolver (primaryIdentifier = NCBI Gene ID):
 *     → Skip ESearch entirely → go direct to ESummary (Path A) with the Gene ID
 *     → Fetch ELink (Path B) eagerly (single gene card)
 *     → resolutionPath: "direct-efetch"
 *
 *   Case B — MEDIUM confidence Gene OR queryType = "Gene" + medium tier:
 *     → ESearch using normalizedQuery (symbol search in Homo sapiens first, then broad)
 *     → ESummary for top results → Path B for primary result only
 *     → resolutionPath: "esearch-symbol"
 *
 *   Case C — queryType ≠ "Gene" OR no resolver context:
 *     → If query looks like a gene symbol (GENE_SYMBOL_RE): ESearch by symbol
 *     → Otherwise: pass query as free-text ESearch term
 *     → resolutionPath: "esearch-symbol" or "esearch-query"
 *
 *   Non-gene types (Disease, Organism, Accession, etc.) with HIGH confidence:
 *     → Skip gene module entirely (caller checks resolver.queryType before calling)
 *
 * Multi-result handling (Step 4):
 *   - Gene symbol searches can return multiple records across organisms (e.g. TP53 in
 *     Homo sapiens, Mus musculus, Rattus norvegicus, etc.)
 *   - If resolver has identified organism context: prefer that organism's record first
 *   - If no organism context: return ALL matching records ordered by NCBI relevance
 *   - ELink (Path B) is fetched EAGERLY for the first (primary) result only
 *   - ELink for remaining results is NOT fetched (lazy — user must expand a record)
 *   - This prevents N ELink calls firing simultaneously for a 10-result gene list
 *
 * Rate limit (Step 5):
 *   Gene ESearch + ESummary + ELink = up to 3 NCBI calls per initial resolution.
 *   Sequential calls with 350ms delays within this module.
 *   The module itself is called sequentially after PubMed, GEO, and Sequence Foundation.
 *
 * In-session Gene ID cache (Step 5):
 *   A lightweight in-memory Map<geneId, RawGeneESummaryEntry> is created per call
 *   and passed through the pipeline. This avoids repeat ESummary calls when the same
 *   Gene ID appears multiple times within one request (resolver + gene module + future
 *   transcript lookup). Does NOT touch Redis or any persistent cache.
 *
 * Path B failure semantics (Step 6):
 *   - If Path A (ESummary) fails → status: "error", no data
 *   - If Path A succeeds, Path B (ELink) fails → status: "partial", core gene data shown,
 *     cross-database fields (ensemblId) set to null with enrichmentNote
 *
 * Spec constraint — do NOT call gene module when resolver identifies:
 *   - queryType === "Organism" with HIGH confidence
 *   - queryType === "Disease" with HIGH confidence
 *   - queryType is Accession, Assembly, Chromosome, Transcript, Protein, Genome
 *   The caller (app/api/analyze/route.ts) is responsible for this gating.
 */

import type { GeneRecord } from "@/types/gene-record";
import type { ModuleResult, ExploreOptions } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import type { QueryResolution } from "@/types/query-resolution";

import {
  geneESearch,
  geneESummary,
  humanGeneSearchTerm,
  broadGeneSearchTerm,
  sleep,
  GENE_RATE_DELAY_MS,
  type RawGeneESummaryEntry,
} from "./search";
import { fetchGeneLinks } from "./links";
import { parseGeneRecord } from "./parser";

// ── Gene symbol pattern ───────────────────────────────────────────────────────
// Matches common gene symbol formats across organisms:
//   Human:  TP53, BRCA1, EGFR (all uppercase + digits)
//   Mouse:  Trp53, Brca1, Cdkn2a (leading uppercase or mixed-case)
//   Plant:  rbcL, lacZ (mixed-case with at least one uppercase or digit)
// Guard: at least one uppercase letter OR digit prevents generic lowercase
// words ("kinase", "protein", "receptor") from routing through symbol search.
const GENE_SYMBOL_RE = /^[A-Za-z][A-Za-z0-9]{1,12}$/;

function looksLikeGeneSymbol(s: string): boolean {
  if (!GENE_SYMBOL_RE.test(s)) return false;
  // Require at least one uppercase letter OR digit — screens out common lowercase
  // words ("kinase", "receptor") that are not gene symbols.
  return /[A-Z0-9]/.test(s);
}

// ── Accession types that gate out the gene module ─────────────────────────────
// When the resolver identified any of these types at HIGH confidence, the gene
// module should NOT run. The API route enforces this but document it here too.
const NON_GENE_HIGH_CONFIDENCE_TYPES = new Set([
  "Organism",
  "Disease",
  "Accession",
  "Assembly",
  "Chromosome",
  "Transcript",
  "Protein",
  "Genome",
  "Taxonomy",
  "Plasmid",
  "Contig",
]);

// ── Options ───────────────────────────────────────────────────────────────────

export interface GeneExploreOptions extends ExploreOptions {
  /**
   * Structured resolution from Phase 5.1.5 resolver.
   * When present and queryType === "Gene" with HIGH confidence,
   * the module skips ESearch and uses the Gene ID directly.
   */
  resolution?: QueryResolution | null;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Search for gene records for the given query string.
 *
 * Returns ModuleResult<GeneRecord> following the same contract as searchPubMed,
 * searchGeoDatasets, and searchSequenceResources.
 *
 * Pagination:
 *   Multi-organism gene searches support pagination via offset.
 *   Single-gene HIGH-confidence queries return 1 record (no pagination needed).
 */
export async function searchGeneExplorer(
  query: string,
  options: GeneExploreOptions = {}
): Promise<ModuleResult<GeneRecord>> {
  const startedAt = performance.now();
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  const resolution = options.resolution ?? null;

  const q = query.trim();
  if (!q) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  // ── Gate: skip if resolver identified a non-gene type at HIGH confidence ───
  if (
    resolution &&
    resolution.confidenceTier === "high" &&
    NON_GENE_HIGH_CONFIDENCE_TYPES.has(resolution.queryType)
  ) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  try {
    // ── Case A: HIGH confidence Gene — use resolver's Gene ID directly ────────
    if (
      resolution &&
      resolution.queryType === "Gene" &&
      resolution.confidenceTier === "high" &&
      resolution.primaryIdentifier
    ) {
      return await resolveByGeneId(
        resolution.primaryIdentifier,
        startedAt
      );
    }

    // ── Case B/C: ESearch needed ───────────────────────────────────────────────
    const isSymbol = looksLikeGeneSymbol(q);

    if (isSymbol) {
      return await resolveBySymbol(q, limit, offset, resolution, startedAt);
    } else {
      return await resolveByFreeText(q, limit, offset, startedAt);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let code = "GENE_ERROR";
    if (message.includes("429") || message.toLowerCase().includes("rate")) {
      code = "RATE_LIMITED";
    } else if (message.includes("HTTP 5")) {
      code = "NCBI_UNAVAILABLE";
    } else if (message.includes("JSON") || message.includes("parse")) {
      code = "PARSER_ERROR";
    } else if (message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch")) {
      code = "NETWORK_ERROR";
    }
    return buildModuleResult({
      module: "gene-explorer",
      status: "error",
      data: [],
      error: toModuleError(code, err),
      startedAt,
    });
  }
}

// ── Case A: Direct EFetch by Gene ID ─────────────────────────────────────────

async function resolveByGeneId(
  geneId: string,
  startedAt: number
): Promise<ModuleResult<GeneRecord>> {
  // In-session cache: avoid duplicate ESummary calls within this request
  const cache = new Map<string, RawGeneESummaryEntry>();

  const entries = await geneESummary([geneId]);
  const entry = entries[0];

  if (!entry) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  cache.set(geneId, entry);

  // Path B: fetch ELink eagerly for single-gene result
  await sleep(GENE_RATE_DELAY_MS);
  let linkData = null;
  let linkStatus: GeneRecord["linkEnrichment"] = "full";
  let enrichmentNote: string | undefined;

  try {
    linkData = await fetchGeneLinks(geneId);
  } catch (linkErr) {
    linkStatus = "partial";
    enrichmentNote =
      `Cross-database enrichment (ELink) failed: ${
        linkErr instanceof Error ? linkErr.message : String(linkErr)
      }. Core gene data shown; Ensembl ID not available.`;
  }

  const record = parseGeneRecord(entry, linkData, "direct-efetch", linkStatus, enrichmentNote);

  return buildModuleResult({
    module: "gene-explorer",
    status: linkStatus === "partial" ? "partial" : "success",
    data: [record],
    error: linkStatus === "partial"
      ? { code: "ENRICHMENT_PARTIAL", message: enrichmentNote! }
      : null,
    startedAt,
    totalCount: 1,
    pageSize: 1,
    offset: 0,
    hasMore: false,
    nextOffset: undefined,
    currentPage: 1,
    totalPages: 1,
    hitUpstreamLimit: false,
  });
}

// ── Case B: ESearch by gene symbol ────────────────────────────────────────────

async function resolveBySymbol(
  symbol: string,
  limit: number,
  offset: number,
  resolution: QueryResolution | null,
  startedAt: number
): Promise<ModuleResult<GeneRecord>> {
  const q = symbol.toUpperCase();

  // If resolver gave us organism context, search in that organism first
  const resolverTaxId = resolution?.taxonomyId;
  const resolverOrganism = resolution?.organism;

  let allIds: string[] = [];
  let totalCount = 0;

  // Step 1: Try human-specific search (most common intent)
  const humanResult = await geneESearch(humanGeneSearchTerm(q), limit + offset);
  if (humanResult.count > 0) {
    totalCount = humanResult.count;
    allIds = humanResult.ids;
  }

  // Step 2: Broad search if no human results or resolver specified non-human organism
  const wantsNonHuman =
    resolverTaxId && resolverTaxId !== "9606" && resolverOrganism;

  if (humanResult.count === 0 || wantsNonHuman) {
    await sleep(GENE_RATE_DELAY_MS);
    const broadResult = await geneESearch(broadGeneSearchTerm(q), limit + offset + 10);
    if (broadResult.count > 0) {
      totalCount = broadResult.count;
      allIds = broadResult.ids;
    }
  }

  if (allIds.length === 0 || totalCount === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  // Apply offset
  const pageIds = allIds.slice(offset, offset + limit);
  if (pageIds.length === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount,
      pageSize: limit,
      offset,
      hasMore: false,
    });
  }

  // Step 3: Fetch ESummary for this page
  await sleep(GENE_RATE_DELAY_MS);
  const entries = await geneESummary(pageIds);

  if (entries.length === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  // Step 4: Sort — resolver-matched organism first (if any)
  const sorted = sortByResolverContext(entries, resolverTaxId, resolverOrganism);

  // Step 5: Path B — eager ELink for primary result only; lazy for the rest
  const primaryEntry = sorted[0];
  await sleep(GENE_RATE_DELAY_MS);

  let primaryLinkData = null;
  let primaryLinkStatus: GeneRecord["linkEnrichment"] = "full";
  let primaryEnrichmentNote: string | undefined;

  try {
    primaryLinkData = await fetchGeneLinks(primaryEntry.uid);
  } catch (linkErr) {
    primaryLinkStatus = "partial";
    primaryEnrichmentNote =
      `ELink enrichment failed: ${
        linkErr instanceof Error ? linkErr.message : String(linkErr)
      }. Cross-database IDs not available.`;
  }

  // Step 6: Parse all records; only primary gets Path B data
  const records = sorted.map((entry, idx) => {
    if (idx === 0) {
      return parseGeneRecord(
        entry,
        primaryLinkData,
        "esearch-symbol",
        primaryLinkStatus,
        primaryEnrichmentNote
      );
    }
    // Remaining records: Path B not fetched (lazy), linkEnrichment = "none"
    return parseGeneRecord(entry, null, "esearch-symbol", "none");
  });

  const hasMore = offset + records.length < Math.min(totalCount, 9999);
  const nextOffset = hasMore ? offset + records.length : undefined;

  return buildModuleResult({
    module: "gene-explorer",
    status: primaryLinkStatus === "partial" ? "partial" : "success",
    data: records,
    error: primaryLinkStatus === "partial"
      ? { code: "ENRICHMENT_PARTIAL", message: primaryEnrichmentNote! }
      : null,
    startedAt,
    totalCount,
    pageSize: limit,
    offset,
    hasMore,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    currentPage: Math.floor(offset / limit) + 1,
    totalPages: Math.ceil(totalCount / limit),
    hitUpstreamLimit: totalCount > 9999 && !hasMore,
  });
}

// ── Case C: ESearch by free-text query ────────────────────────────────────────

async function resolveByFreeText(
  query: string,
  limit: number,
  offset: number,
  startedAt: number
): Promise<ModuleResult<GeneRecord>> {
  const { count: totalCount, ids } = await geneESearch(query, limit + offset);

  if (totalCount === 0 || ids.length === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  const pageIds = ids.slice(offset, offset + limit);
  if (pageIds.length === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount,
      pageSize: limit,
      offset,
      hasMore: false,
    });
  }

  await sleep(GENE_RATE_DELAY_MS);
  const entries = await geneESummary(pageIds);

  if (entries.length === 0) {
    return buildModuleResult({
      module: "gene-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  const primaryEntry = entries[0];
  await sleep(GENE_RATE_DELAY_MS);

  let primaryLinkData = null;
  let primaryLinkStatus: GeneRecord["linkEnrichment"] = "full";
  let primaryEnrichmentNote: string | undefined;

  try {
    primaryLinkData = await fetchGeneLinks(primaryEntry.uid);
  } catch (linkErr) {
    primaryLinkStatus = "partial";
    primaryEnrichmentNote =
      `ELink enrichment failed: ${
        linkErr instanceof Error ? linkErr.message : String(linkErr)
      }. Cross-database IDs not available.`;
  }

  const records = entries.map((entry, idx) => {
    if (idx === 0) {
      return parseGeneRecord(
        entry,
        primaryLinkData,
        "esearch-query",
        primaryLinkStatus,
        primaryEnrichmentNote
      );
    }
    return parseGeneRecord(entry, null, "esearch-query", "none");
  });

  const hasMore = offset + records.length < Math.min(totalCount, 9999);
  const nextOffset = hasMore ? offset + records.length : undefined;

  return buildModuleResult({
    module: "gene-explorer",
    status: primaryLinkStatus === "partial" ? "partial" : "success",
    data: records,
    error: primaryLinkStatus === "partial"
      ? { code: "ENRICHMENT_PARTIAL", message: primaryEnrichmentNote! }
      : null,
    startedAt,
    totalCount,
    pageSize: limit,
    offset,
    hasMore,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    currentPage: Math.floor(offset / limit) + 1,
    totalPages: Math.ceil(totalCount / limit),
    hitUpstreamLimit: totalCount > 9999 && !hasMore,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sort ESummary entries so the resolver-matched organism appears first.
 * If no organism context: preserve NCBI's default relevance order.
 */
function sortByResolverContext(
  entries: RawGeneESummaryEntry[],
  resolverTaxId: string | undefined,
  resolverOrganism: string | undefined
): RawGeneESummaryEntry[] {
  if (!resolverTaxId && !resolverOrganism) return entries;

  return [...entries].sort((a, b) => {
    const aMatch =
      (resolverTaxId && String(a.organism.taxid) === resolverTaxId) ||
      (resolverOrganism &&
        a.organism.scientificname.toLowerCase().includes(resolverOrganism.toLowerCase()));
    const bMatch =
      (resolverTaxId && String(b.organism.taxid) === resolverTaxId) ||
      (resolverOrganism &&
        b.organism.scientificname.toLowerCase().includes(resolverOrganism.toLowerCase()));

    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
}

export type { GeneRecord } from "@/types/gene-record";
