/**
 * lib/transcript/index.ts — Transcript Explorer module orchestrator (Phase 5.3A)
 *
 * Public API: searchTranscripts(geneId, geneSymbol, organism, taxonomyId, options)
 *             → ModuleResult<TranscriptRecord>
 *
 * This module is called by the Gene Explorer (lib/gene/index.ts) after resolving
 * the primary gene. It receives a geneId — NOT a raw query string.
 *
 * Data retrieval strategy:
 *   Step 1: fetchGeneTable(geneId)    — always, all organisms
 *   Step 2: fetchManeInfo(geneId)     — human (taxid 9606) only
 *     a. ESearch for MANE Select[Keyword]
 *     b. ESearch for MANE Plus Clinical[Keyword]
 *     c. ESummary for combined MANE UIDs → get accession versions
 *
 * Entrez call count per invocation:
 *   Non-human: +1 (gene_table EFetch)
 *   Human:     +4 (gene_table + MANE Select ESearch + MANE Plus Clinical ESearch
 *                 + combined nuccore ESummary)
 *
 * Rate limiting:
 *   GENE_RATE_DELAY_MS (350ms) between each NCBI call within this module.
 *   The Gene Explorer inserts one additional delay before calling this module.
 *   Total post-Phase-5.2 calls per human gene query:
 *     Phase 5.2: ESummary + ELink = 2 calls + 1 delay
 *     Phase 5.3A adds: gene_table + MANE ESearch ×2 + nuccore ESummary = 4 more calls
 *
 * In-session caching:
 *   Callers may pass a Map<geneId, TranscriptRecord[]> cache object.
 *   If the geneId is already in cache, the NCBI calls are skipped entirely.
 *   This prevents re-fetching when the same geneId appears multiple times in
 *   one request (e.g. Load More scenario where primary gene is re-shown).
 *
 * Failure semantics:
 *   - gene_table fetch fails → status: "error", records: null, gene card unaffected
 *   - gene_table succeeds, MANE fetch fails → status: "partial", records shown with
 *     isCanonical: null on all transcripts (cannot confirm MANE without the data)
 *   - Gene has no transcripts in gene_table → status: "empty"
 *
 * Phase 5.4 handoff:
 *   TranscriptRecord.proteinAccession / proteinAccessionVersion are populated directly
 *   from gene_table protein isoform lines when present (NM_/XM_ transcripts only).
 *   When a coding transcript's protein line cannot be parsed, these fields are null
 *   with a `// TODO Phase 5.4: fetch protein accession via ELink db=gene→db=protein`
 *   marker in lib/transcript/parser.ts — Phase 5.4 can reuse geneId/proteinAccession
 *   as-is and only needs to backfill the null cases via ELink.
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import { sortTranscripts } from "@/types/transcript-record";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";
import { fetchGeneTable, fetchManeInfo } from "./fetch";
import { parseGeneTable } from "./parser";

// ── Options ───────────────────────────────────────────────────────────────────

export interface TranscriptSearchOptions {
  /** In-session cache keyed by geneId. Pass a shared Map across calls in one request. */
  cache?: Map<string, TranscriptRecord[]>;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fetch and parse the transcript list for a given NCBI Gene.
 *
 * @param geneId      NCBI Gene ID (numeric string, e.g. "7157")
 * @param geneSymbol  Official gene symbol (e.g. "TP53")
 * @param organism    Organism scientific name (e.g. "Homo sapiens")
 * @param taxonomyId  NCBI Taxonomy ID string (e.g. "9606" for human)
 * @param options     Optional cache and configuration
 */
export async function searchTranscripts(
  geneId: string,
  geneSymbol: string,
  organism: string,
  taxonomyId: string,
  options: TranscriptSearchOptions = {}
): Promise<ModuleResult<TranscriptRecord>> {
  const startedAt = performance.now();
  const isHuman = taxonomyId === "9606";

  // ── In-session cache check ─────────────────────────────────────────────────
  const cache = options.cache;
  if (cache?.has(geneId)) {
    const cached = cache.get(geneId)!;
    return buildModuleResult({
      module: "transcript-explorer",
      status: cached.length > 0 ? "success" : "empty",
      data: cached,
      error: null,
      startedAt,
      totalCount: cached.length,
      pageSize: cached.length,
      offset: 0,
      hasMore: false,
      currentPage: 1,
      totalPages: 1,
      hitUpstreamLimit: false,
    });
  }

  try {
    // ── Step 1: Fetch gene_table (all organisms) ─────────────────────────────
    const tableText = await fetchGeneTable(geneId);

    // ── Step 2: Fetch MANE info (human only) ─────────────────────────────────
    let maneInfo = null;
    let maneError: string | undefined;

    if (isHuman) {
      await sleep(GENE_RATE_DELAY_MS);
      try {
        maneInfo = await fetchManeInfo(geneId, sleep, GENE_RATE_DELAY_MS);
      } catch (maneErr) {
        // MANE fetch failed — records will still be shown with isCanonical: null
        maneError =
          `MANE Select status unavailable: ${
            maneErr instanceof Error ? maneErr.message : String(maneErr)
          }`;
      }
    }

    // ── Step 3: Parse gene_table into TranscriptRecord[] ─────────────────────
    const records = parseGeneTable(
      tableText,
      geneId,
      geneSymbol,
      organism,
      maneInfo,
      isHuman
    );

    if (records.length === 0) {
      if (cache) cache.set(geneId, []);
      return buildModuleResult({
        module: "transcript-explorer",
        status: "empty",
        data: [],
        error: null,
        startedAt,
      });
    }

    // ── Step 4: Sort and cache ────────────────────────────────────────────────
    const sorted = sortTranscripts(records);
    if (cache) cache.set(geneId, sorted);

    const hasMANEError = isHuman && maneError !== undefined;

    return buildModuleResult({
      module: "transcript-explorer",
      status: hasMANEError ? "partial" : "success",
      data: sorted,
      error: hasMANEError
        ? { code: "MANE_PARTIAL", message: maneError! }
        : null,
      startedAt,
      totalCount: sorted.length,
      pageSize: sorted.length,
      offset: 0,
      hasMore: false,
      nextOffset: undefined,
      currentPage: 1,
      totalPages: 1,
      hitUpstreamLimit: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let code = "TRANSCRIPT_ERROR";
    if (message.includes("429") || message.toLowerCase().includes("rate")) {
      code = "RATE_LIMITED";
    } else if (message.includes("HTTP 5")) {
      code = "NCBI_UNAVAILABLE";
    } else if (
      message.toLowerCase().includes("network") ||
      message.toLowerCase().includes("fetch")
    ) {
      code = "NETWORK_ERROR";
    }
    return buildModuleResult({
      module: "transcript-explorer",
      status: "error",
      data: [],
      error: toModuleError(code, err),
      startedAt,
    });
  }
}
