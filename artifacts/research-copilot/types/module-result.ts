/**
 * ModuleResult<T> — the single shared response contract for ALL TypeScript scientific modules.
 *
 * Every present and future TypeScript database module MUST return ModuleResult<T>:
 *   - PubMed    → ModuleResult<Paper>
 *   - GEO       → ModuleResult<Dataset>
 *   - GenBank   → ModuleResult<GenBankRecord>   (future)
 *   - ENA       → ModuleResult<ENARecord>       (future)
 *   - SRA       → ModuleResult<SRARecord>       (future)
 *   - UniProt   → ModuleResult<UniProtEntry>    (future)
 *   - KEGG      → ModuleResult<KEGGEntry>       (future)
 *   - Reactome  → ModuleResult<ReactomePathway> (future)
 *   - PDB       → ModuleResult<PDBStructure>    (future)
 *   - AlphaFold → ModuleResult<AlphaFoldModel>  (future)
 *
 * Relationship to the Python service's ErrorResponse shape:
 * The Python FastAPI service uses its own ErrorResponse (fields: error.code, error.message,
 * error.module, error.request_id). ModuleError below is conceptually related but
 * intentionally separate — it lives on the TypeScript side only. A future phase may want to
 * reconcile these two shapes (e.g. add a request_id-equivalent field here and align them
 * across language boundaries), but that is explicitly out of scope for this phase.
 */

/**
 * Structured error returned when a module fails completely or partially.
 * `code` is a short machine-readable identifier (e.g. "ESEARCH_FAILED").
 * `message` is a human-readable description of what went wrong.
 */
export interface ModuleError {
  code: string;
  message: string;
}

/**
 * The standardised response envelope for every TypeScript scientific module.
 *
 * Status semantics:
 *   "success" — all upstream calls succeeded and data.length > 0.
 *   "empty"   — all upstream calls succeeded but zero matching records were found.
 *   "partial" — some upstream calls failed but useful data still exists (data.length > 0).
 *   "error"   — the module failed completely; data is always [] when status is "error".
 *
 * Core invariants:
 *   - `count` is always computed as data.length — never manually assigned.
 *   - `cached` is always false until Redis caching is wired to these TypeScript modules.
 *     TODO: update `cached` to true when Redis integration is added.
 *   - `timestamp` is an ISO 8601 string, e.g. "2026-06-25T15:20:31.000Z".
 *   - `executionTimeMs` is wall-clock time from function entry to return, in milliseconds.
 *
 * Pagination fields (all optional — only set when the module explicitly supports pagination):
 *   Modules that do NOT set pagination fields behave exactly as before (backward compatible).
 *   Modules that DO set pagination fields MUST follow the contract in each field's JSDoc.
 *
 * Future modules (GenBank, ENA, SRA, UniProt, KEGG, Reactome) MUST implement the same
 * exploration interface including `hitUpstreamLimit` where the upstream API has an equivalent
 * ceiling. Do NOT invent per-module pagination shapes — always extend this interface.
 *
 * WebEnv/QueryKey note: NCBI's history server mechanism (usehistory=y, WebEnv, query_key)
 * allows paginating beyond the retstart+retmax≈9999 ceiling. This is NOT implemented in
 * Phase 4 and is explicitly deferred. When implemented, it will not require changing the
 * ModuleResult interface — only the internal pipeline in search.ts files.
 */
export interface ModuleResult<T> {
  /** Identifier for the module that produced this result, e.g. "pubmed" or "geo" */
  module: string;
  status: "success" | "partial" | "empty" | "error";
  data: T[];
  /** Always equal to data.length — never manually assigned */
  count: number;
  error: ModuleError | null;
  /** Wall-clock execution time in milliseconds */
  executionTimeMs: number;
  /** TODO: set to true when Redis caching is connected to these TypeScript modules */
  cached: boolean;
  /** ISO 8601 timestamp of when the result was produced, e.g. "2026-06-25T15:20:31.000Z" */
  timestamp: string;

  // ── Pagination fields ────────────────────────────────────────────────────────
  // All optional. Absent on modules that don't support pagination.
  // When present, all fields below form a consistent, self-describing page descriptor.

  /**
   * Total number of records matching the query in the upstream database (e.g. NCBI count).
   * This is the NCBI raw count BEFORE any parser-side filtering (e.g. GSE-only filter in GEO).
   * May be larger than what is actually pageable due to upstream ceilings — see hitUpstreamLimit.
   */
  totalCount?: number;

  /**
   * Number of records requested per page (the `limit` parameter).
   * Actual records returned (data.length) may be less than pageSize on the final page.
   */
  pageSize?: number;

  /**
   * Zero-based offset of the first record in this result page.
   * Maps directly to NCBI ESearch `retstart`. Page 1 = offset 0.
   */
  offset?: number;

  /**
   * Whether more records are available beyond this page.
   * False when either: (a) results are genuinely exhausted, or (b) hitUpstreamLimit is true.
   * The UI must distinguish these two cases — use hitUpstreamLimit for that distinction.
   */
  hasMore?: boolean;

  /**
   * The offset value to send in the next Load More request.
   * Only present when hasMore === true. Undefined (not 0) when there is no next page.
   * Computed as: offset + data.length (accounts for pages that return fewer records than pageSize).
   */
  nextOffset?: number;

  /**
   * 1-based current page number. Computed as Math.floor(offset / pageSize) + 1.
   * Informational — not needed by the Load More mechanism, but useful for display.
   */
  currentPage?: number;

  /**
   * Total number of pageable pages, if determinable.
   * Computed as Math.ceil(totalCount / pageSize).
   * May be absent when totalCount is unknown, or misleading when hitUpstreamLimit is true
   * (because not all totalCount pages are actually reachable via retstart/retmax).
   * Future modules with WebEnv/QueryKey support may be able to provide a more accurate value.
   */
  totalPages?: number;

  /**
   * True when hasMore is false specifically because an upstream API ceiling was hit —
   * NOT because results are genuinely exhausted.
   *
   * NCBI ESearch ceiling: retstart + retmax ≈ 9,999. Any page where offset + pageSize > 9,999
   * will have hitUpstreamLimit = true. In this state, totalCount may still show millions of
   * matching records, but none beyond position ~9,999 are accessible via retstart/retmax.
   *
   * The UI MUST distinguish this from genuine exhaustion:
   *   - hasMore=false, hitUpstreamLimit=false → "You've seen all available results."
   *   - hasMore=false, hitUpstreamLimit=true  → "Showing the first N of totalCount results —
   *       narrow your search for more specific results."
   *
   * Deferred: NCBI WebEnv/QueryKey history server can bypass this ceiling but is not yet
   * implemented. When added, hitUpstreamLimit should become false for those queries.
   *
   * Future modules: ENA, SRA, UniProt, KEGG, Reactome all have equivalent API ceilings
   * that must be surfaced with this same field.
   */
  hitUpstreamLimit?: boolean;
}

// ─── Helpers (internal use by module implementations) ─────────────────────────

/**
 * Build a ModuleResult<T> from a `performance.now()` start time and partial fields.
 * Automatically computes `count` (= data.length), `executionTimeMs`, and `timestamp`.
 * Accepts all optional pagination fields — pass only the ones the module supports.
 *
 * @internal — consumed by module index files; not part of the external API surface.
 */
export function buildModuleResult<T>(opts: {
  module: string;
  status: ModuleResult<T>["status"];
  data: T[];
  error: ModuleError | null;
  startedAt: number;
  // Optional pagination fields
  totalCount?: number;
  pageSize?: number;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number;
  currentPage?: number;
  totalPages?: number;
  hitUpstreamLimit?: boolean;
}): ModuleResult<T> {
  return {
    module: opts.module,
    status: opts.status,
    data: opts.data,
    count: opts.data.length,
    error: opts.error,
    executionTimeMs: Math.round(performance.now() - opts.startedAt),
    cached: false, // TODO: set to true when Redis caching is connected
    timestamp: new Date().toISOString(),
    // Pagination — only include defined fields so consumers can check `field !== undefined`
    ...(opts.totalCount !== undefined && { totalCount: opts.totalCount }),
    ...(opts.pageSize !== undefined && { pageSize: opts.pageSize }),
    ...(opts.offset !== undefined && { offset: opts.offset }),
    ...(opts.hasMore !== undefined && { hasMore: opts.hasMore }),
    ...(opts.nextOffset !== undefined && { nextOffset: opts.nextOffset }),
    ...(opts.currentPage !== undefined && { currentPage: opts.currentPage }),
    ...(opts.totalPages !== undefined && { totalPages: opts.totalPages }),
    ...(opts.hitUpstreamLimit !== undefined && { hitUpstreamLimit: opts.hitUpstreamLimit }),
  };
}

/**
 * Convert an unknown thrown value into a structured ModuleError.
 * @internal — consumed by module index files.
 */
export function toModuleError(code: string, err: unknown): ModuleError {
  const message = err instanceof Error ? err.message : String(err);
  return { code, message };
}

// ─── Universal Exploration Contract ──────────────────────────────────────────

/**
 * Options shared by ALL scientific module search functions.
 *
 * Every present and future module MUST accept these options and map them to the
 * upstream API's equivalent pagination mechanism:
 *   - NCBI (PubMed, GEO, GenBank, SRA) → retstart=offset, retmax=limit
 *   - ENA                               → offset=offset, limit=limit
 *   - UniProt                           → from=offset, size=limit
 *   - KEGG, Reactome, PDB, AlphaFold   → module-specific, document the mapping
 *
 * Default values (limit=10, offset=0) must be applied when not provided, preserving
 * backward compatibility with callers that don't pass exploration options.
 *
 * hitUpstreamLimit semantics apply to ALL modules — if the upstream API has an equivalent
 * ceiling, the module must set hitUpstreamLimit=true in the returned ModuleResult when hit.
 */
export interface ExploreOptions {
  /** Maximum number of records to return. Default: 10. */
  limit?: number;
  /** Zero-based offset of the first record to return. Default: 0. */
  offset?: number;
}
