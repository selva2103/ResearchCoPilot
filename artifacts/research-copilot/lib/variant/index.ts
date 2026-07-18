/**
 * lib/variant/index.ts — Variant Explorer module orchestrator (Phase 5.5A)
 *
 * Public API:
 *   searchVariants(geneId, options)       → ModuleResult<VariantRecord>
 *   lookupVariantByRsId(rsDigits)         → ModuleResult<VariantRecord>
 *   lookupVariantByVariationId(id)        → ModuleResult<VariantRecord>
 *
 * Pipeline (gene-level list):
 *   1. Build filter query string from options
 *   2. Check in-memory list cache (variant:list:{geneId}:{offset}:{pageSize}:{filter}:{sort})
 *   3. ClinVar ESearch → Variation ID list (paginated)
 *   4. ClinVar ESummary → raw entries for this page's IDs
 *   5. Parse each entry into VariantRecord
 *   6. Cache result + return ModuleResult<VariantRecord>
 *
 * Pipeline (standalone identifier lookup):
 *   1. ESearch by rsID / Variation ID → UID list
 *   2. ESummary for those UIDs
 *   3. Parse + return ModuleResult<VariantRecord>
 *
 * Rate limit:
 *   Two NCBI calls per list request (ESearch + ESummary batch).
 *   Sequential with VARIANT_RATE_DELAY_MS delays between calls.
 *   fetchWithRetry handles HTTP 429 backoff automatically.
 *
 * Non-human guard:
 *   ClinVar is a human-centric database. The caller (route handler) is responsible
 *   for checking organism / taxonomyId before calling searchVariants.
 *   These functions do NOT check organism — they assume human data is requested.
 *
 * Cache architecture:
 *   In-memory Maps (no Redis). Module-level singletons — survive for the process lifetime.
 *   Namespaces: "variant:list:{geneId}:{offset}:{pageSize}:{filter}:{sort}"
 *                "variant:detail:{clinvarVariationId}"
 *   Cache TTL: none (in-memory, evicted on restart). Entries are bounded by NCBI data.
 *
 * NCBI ESearch ceiling:
 *   retstart + retmax ≤ 9999. When offset + pageSize > 9999, hitUpstreamLimit = true.
 *   hitUpstreamLimit is set even if BRCA1's 15,986 total count implies more pages exist —
 *   they are not accessible via retstart/retmax.
 */

import type { VariantRecord } from "@/types/variant-record";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import type { VariantListOptions } from "@/types/variant-record";

import {
  clinvarESearchByGene,
  clinvarESearchByRsId,
  clinvarESearchByVariationId,
  clinvarESummary,
  sleep,
  VARIANT_RATE_DELAY_MS,
} from "./search";
import { parseVariantRecord } from "./parse";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const NCBI_ESEARCH_CEILING = 9999;
const MODULE_NAME = "clinvar-variants";

// ── In-memory cache ────────────────────────────────────────────────────────────

const listCache = new Map<string, ModuleResult<VariantRecord>>();
const detailCache = new Map<string, ModuleResult<VariantRecord>>();

// ── Filter string builder ──────────────────────────────────────────────────────

/**
 * Build the combined NCBI ESearch filter string from options.
 * Returns null when no filtering is requested.
 */
function buildFilterString(options: VariantListOptions): string | null {
  const parts: string[] = [];
  if (options.significanceFilter) {
    parts.push(`"${options.significanceFilter}"[clinical_significance]`);
  }
  if (options.variantTypeFilter) {
    parts.push(`"${options.variantTypeFilter}"[Variant Type]`);
  }
  return parts.length > 0 ? parts.join(" AND ") : null;
}

/** Build a normalized cache key for a list request. */
function buildListCacheKey(
  geneId: string,
  offset: number,
  pageSize: number,
  filter: string | null,
  sort: string
): string {
  return `variant:list:${geneId}:${offset}:${pageSize}:${filter ?? ""}:${sort}`;
}

// ── Main public exports ────────────────────────────────────────────────────────

/**
 * Retrieve a paginated list of ClinVar variants for a gene.
 *
 * @param geneId - NCBI Gene ID (numeric string), e.g. "7157"
 * @param options - Pagination, filter, and sort options
 */
export async function searchVariants(
  geneId: string,
  options: VariantListOptions = {}
): Promise<ModuleResult<VariantRecord>> {
  const startedAt = performance.now();

  const pageSize = Math.min(
    Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const offset = Math.max(0, options.offset ?? 0);
  const sort = options.sort ?? "default";
  const filterString = buildFilterString(options);
  const sortParam = sort === "relevance" ? "relevance" : null;

  const cacheKey = buildListCacheKey(geneId, offset, pageSize, filterString, sort);
  const cached = listCache.get(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // ── NCBI ceiling check ────────────────────────────────────────────────────
  if (offset >= NCBI_ESEARCH_CEILING) {
    const result = buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: "empty",
      data: [],
      error: null,
      startedAt,
      totalCount: undefined,
      pageSize,
      offset,
      hasMore: false,
      hitUpstreamLimit: true,
    });
    return result;
  }

  try {
    // ── Step 1: ESearch to get Variation IDs for this page ─────────────────
    const searchResult = await clinvarESearchByGene(
      geneId,
      pageSize,
      offset,
      filterString,
      sortParam
    );

    const esearch = searchResult.esearchresult;
    const totalCount = parseInt(esearch.count, 10) || 0;
    const ids = esearch.idlist ?? [];

    if (ids.length === 0) {
      const result = buildModuleResult<VariantRecord>({
        module: MODULE_NAME,
        status: "empty",
        data: [],
        error: null,
        startedAt,
        totalCount,
        pageSize,
        offset,
        hasMore: false,
        nextOffset: undefined,
        currentPage: Math.floor(offset / pageSize) + 1,
        totalPages: Math.ceil(totalCount / pageSize),
        hitUpstreamLimit: false,
      });
      listCache.set(cacheKey, result);
      return result;
    }

    // ── Step 2: ESummary for this page's IDs ─────────────────────────────────
    await sleep(VARIANT_RATE_DELAY_MS);
    const summaryMap = await clinvarESummary(ids);

    // ── Step 3: Parse entries ─────────────────────────────────────────────────
    const records: VariantRecord[] = [];
    for (const id of ids) {
      const entry = summaryMap.get(id);
      if (!entry) continue;
      const record = parseVariantRecord(entry);
      if (record) records.push(record);
    }

    // ── Step 4: Pagination metadata ───────────────────────────────────────────
    const nextRawOffset = offset + ids.length;
    const hitCeiling = nextRawOffset >= NCBI_ESEARCH_CEILING;
    const hasMore = nextRawOffset < totalCount && !hitCeiling;

    const result = buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: records.length > 0 ? "success" : "empty",
      data: records,
      error: null,
      startedAt,
      totalCount,
      pageSize,
      offset,
      hasMore,
      nextOffset: hasMore ? nextRawOffset : undefined,
      currentPage: Math.floor(offset / pageSize) + 1,
      totalPages: Math.ceil(Math.min(totalCount, NCBI_ESEARCH_CEILING) / pageSize),
      hitUpstreamLimit: hitCeiling && nextRawOffset < totalCount,
    });

    listCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: "error",
      data: [],
      error: toModuleError("CLINVAR_ESEARCH_FAILED", err),
      startedAt,
    });
  }
}

/**
 * Look up ClinVar variants by dbSNP rsID (digits only, without "rs" prefix).
 * Returns all ClinVar entries matching the rsID (typically 1–3 entries).
 *
 * @param rsDigits - rsID digits only, e.g. "28934578" for rs28934578
 */
export async function lookupVariantByRsId(
  rsDigits: string
): Promise<ModuleResult<VariantRecord>> {
  const startedAt = performance.now();
  const cacheKey = `variant:detail:rs:${rsDigits}`;
  const cached = detailCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  try {
    const searchResult = await clinvarESearchByRsId(rsDigits);
    const ids = searchResult.esearchresult.idlist ?? [];
    const totalCount = parseInt(searchResult.esearchresult.count, 10) || 0;

    if (ids.length === 0) {
      const result = buildModuleResult<VariantRecord>({
        module: MODULE_NAME,
        status: "empty",
        data: [],
        error: null,
        startedAt,
        totalCount: 0,
        pageSize: 10,
        offset: 0,
        hasMore: false,
        hitUpstreamLimit: false,
      });
      detailCache.set(cacheKey, result);
      return result;
    }

    await sleep(VARIANT_RATE_DELAY_MS);
    const summaryMap = await clinvarESummary(ids);

    const records: VariantRecord[] = [];
    for (const id of ids) {
      const entry = summaryMap.get(id);
      if (!entry) continue;
      const record = parseVariantRecord(entry);
      if (record) records.push(record);
    }

    const result = buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: records.length > 0 ? "success" : "empty",
      data: records,
      error: null,
      startedAt,
      totalCount,
      pageSize: ids.length,
      offset: 0,
      hasMore: false,
      hitUpstreamLimit: false,
    });

    detailCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: "error",
      data: [],
      error: toModuleError("CLINVAR_RSID_LOOKUP_FAILED", err),
      startedAt,
    });
  }
}

/**
 * Look up a single ClinVar variant by numeric Variation ID.
 *
 * @param variationId - ClinVar numeric Variation ID (string), e.g. "12375"
 */
export async function lookupVariantByVariationId(
  variationId: string
): Promise<ModuleResult<VariantRecord>> {
  const startedAt = performance.now();
  const cacheKey = `variant:detail:${variationId}`;
  const cached = detailCache.get(cacheKey);
  if (cached) return { ...cached, cached: true };

  try {
    const searchResult = await clinvarESearchByVariationId(variationId);
    const ids = searchResult.esearchresult.idlist ?? [];

    if (ids.length === 0) {
      const result = buildModuleResult<VariantRecord>({
        module: MODULE_NAME,
        status: "empty",
        data: [],
        error: null,
        startedAt,
        totalCount: 0,
        pageSize: 1,
        offset: 0,
        hasMore: false,
        hitUpstreamLimit: false,
      });
      detailCache.set(cacheKey, result);
      return result;
    }

    await sleep(VARIANT_RATE_DELAY_MS);
    const summaryMap = await clinvarESummary(ids);

    const records: VariantRecord[] = [];
    for (const id of ids) {
      const entry = summaryMap.get(id);
      if (!entry) continue;
      const record = parseVariantRecord(entry);
      if (record) records.push(record);
    }

    const result = buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: records.length > 0 ? "success" : "empty",
      data: records,
      error: null,
      startedAt,
      totalCount: records.length,
      pageSize: 1,
      offset: 0,
      hasMore: false,
      hitUpstreamLimit: false,
    });

    detailCache.set(cacheKey, result);
    return result;
  } catch (err) {
    return buildModuleResult<VariantRecord>({
      module: MODULE_NAME,
      status: "error",
      data: [],
      error: toModuleError("CLINVAR_VARID_LOOKUP_FAILED", err),
      startedAt,
    });
  }
}
