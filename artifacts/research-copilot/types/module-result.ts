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
 * Invariants:
 *   - `count` is always computed as data.length — never manually assigned.
 *   - `cached` is always false until Redis caching is wired to these TypeScript modules.
 *     TODO: update `cached` to true when Redis integration is added.
 *   - `timestamp` is an ISO 8601 string, e.g. "2026-06-25T15:20:31.000Z".
 *   - `executionTimeMs` is wall-clock time from function entry to return, in milliseconds.
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
}

// ─── Helpers (internal use by module implementations) ─────────────────────────

/**
 * Build a ModuleResult<T> from a `performance.now()` start time and partial fields.
 * Automatically computes `count` (= data.length), `executionTimeMs`, and `timestamp`.
 *
 * @internal — consumed by module index files; not part of the external API surface.
 */
export function buildModuleResult<T>(opts: {
  module: string;
  status: ModuleResult<T>["status"];
  data: T[];
  error: ModuleError | null;
  startedAt: number;
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
