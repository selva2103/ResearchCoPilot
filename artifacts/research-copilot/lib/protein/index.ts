/**
 * lib/protein/index.ts — Protein Explorer module orchestrator (Phase 5.4A/5.4B)
 *
 * Public API (Phase 5.4A — unchanged):
 *   getProteinsForTranscripts(transcripts) → Promise<ModuleResult<ProteinRecord>>
 *     Filters to coding transcripts with a non-null proteinAccessionVersion,
 *     fetches ESummary for all of them in a single NCBI call, and returns
 *     one ProteinRecord per transcript (in the same order as the input array).
 *
 *   getProteinDetail(proteinAccessionVersion, baseRecord) → Promise<ModuleResult<ProteinRecord>>
 *     Fetches GenPept for a single protein and returns the enriched ProteinRecord.
 *     Called only when the user expands a specific protein sub-panel.
 *
 * Public API (Phase 5.4B — new additive function only):
 *   getProteinResearchContext(genPeptText, proteinRecord, transcriptRecord, geneRecord, normalizedQuery)
 *     → Promise<ModuleResult<ProteinResearchContext>>
 *     Derives a ProteinResearchContext from already-fetched data. Makes ZERO new
 *     network calls. The caller (app/api/protein/research-context route) is
 *     responsible for supplying the raw GenPept text (obtained from fetchProteinDetail).
 *     Results are cached in-process by researchcontext:protein:{accessionVersion} key.
 *
 * NCBI call accounting for Phase 5.4A:
 *   getProteinsForTranscripts: 1 call (batched ESummary — regardless of gene size)
 *   getProteinDetail:          1 call (single GenPept EFetch — on-demand)
 *   FASTA download:            1 call (single FASTA EFetch — via download route)
 *
 * NCBI call accounting for Phase 5.4B:
 *   getProteinResearchContext: 0 calls (pure derivation — caller supplies GenPept text)
 *
 * In-process cache keys (separate namespace from 5.4A's fetch-level keys):
 *   researchcontext:protein:{proteinAccessionVersion}  ← Phase 5.4B (this file)
 *
 * Redis cache keys (documented for future Redis activation):
 *   protein:summary:{proteinAccessionVersion}
 *   protein:detail:{proteinAccessionVersion}
 *   protein:fasta:{proteinAccessionVersion}
 *   TTL: ≥ 86400s (protein records are immutable once versioned)
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import type { ProteinRecord } from "@/types/protein-record";
import type { GeneRecord } from "@/types/gene-record";
import type { NormalizedQuery } from "@/types/normalized-query";
import type { ProteinResearchContext } from "@/types/research-context";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { fetchProteinSummaries, fetchProteinDetail } from "./fetch";
import { parseProteinSummary, enrichWithDetail } from "./parser";
import {
  deriveSummary,
  deriveRoleChips,
  deriveCanonicalExplanation,
  computeAnnotationConfidence,
  mapResolutionConfidence,
  deriveBiologicalImportance,
  buildRelationships,
} from "./research-context";

// ── getProteinsForTranscripts ─────────────────────────────────────────────────

/**
 * Batch-fetch protein summaries for all coding transcripts in a gene.
 *
 * Algorithm:
 *   1. Filter transcripts to those with a non-null proteinAccessionVersion.
 *   2. Collect unique accession versions (preserve first-seen order).
 *   3. Fetch ESummary for all in a single NCBI call.
 *   4. Build ProteinRecord[] by pairing each ESummary entry with its parent transcript.
 *   5. Return in the same order as the input transcripts array.
 *
 * If a transcript's protein is not returned by ESummary (retired/unavailable),
 * that protein is omitted and status is "partial" — transcript rows are unaffected.
 *
 * @param transcripts - TranscriptRecord[] for the gene (sorted as from Transcript Explorer).
 */
export async function getProteinsForTranscripts(
  transcripts: TranscriptRecord[]
): Promise<ModuleResult<ProteinRecord>> {
  const startedAt = performance.now();

  // Step 1 — Filter to coding transcripts with a protein accession.
  const codingTranscripts = transcripts.filter(
    (t): t is TranscriptRecord & { proteinAccessionVersion: string } =>
      t.proteinAccessionVersion !== null && t.proteinAccessionVersion !== undefined
  );

  if (codingTranscripts.length === 0) {
    return buildModuleResult({
      module: "protein-explorer",
      status: "empty",
      data: [],
      error: null,
      startedAt,
    });
  }

  // Step 2 — Collect unique accession versions (preserve order of first occurrence).
  const seenAccessions = new Set<string>();
  const uniqueAccessions: string[] = [];
  for (const t of codingTranscripts) {
    if (!seenAccessions.has(t.proteinAccessionVersion)) {
      seenAccessions.add(t.proteinAccessionVersion);
      uniqueAccessions.push(t.proteinAccessionVersion);
    }
  }

  try {
    // Step 3 — Single batched ESummary call for all protein accessions.
    const summaryMap = await fetchProteinSummaries(uniqueAccessions);

    // Step 4 — Build ProteinRecord[] in input transcript order.
    const records: ProteinRecord[] = [];
    let missingCount = 0;

    for (const t of codingTranscripts) {
      const entry = summaryMap.get(t.proteinAccessionVersion);
      if (!entry) {
        missingCount++;
        continue; // Omit proteins not returned by ESummary.
      }
      records.push(parseProteinSummary(entry, t));
    }

    if (records.length === 0) {
      return buildModuleResult({
        module: "protein-explorer",
        status: "empty",
        data: [],
        error: { code: "NO_PROTEINS_FOUND", message: "No protein summary data returned by NCBI." },
        startedAt,
      });
    }

    const isPartial = missingCount > 0;
    return buildModuleResult({
      module: "protein-explorer",
      status: isPartial ? "partial" : "success",
      data: records,
      error: isPartial
        ? {
            code: "PARTIAL_PROTEINS",
            message: `${missingCount} protein accession(s) not found in NCBI ESummary.`,
          }
        : null,
      startedAt,
    });
  } catch (err) {
    return buildModuleResult({
      module: "protein-explorer",
      status: "error",
      data: [],
      error: toModuleError("PROTEIN_SUMMARY_ERROR", err),
      startedAt,
    });
  }
}

// ── In-process research context cache (Phase 5.4B) ────────────────────────────
// Key format: "researchcontext:protein:{proteinAccessionVersion}"
// Separate namespace from 5.4A's protein:summary / protein:detail / protein:fasta keys.
// The full accession version is always used — never stripped.
const researchContextCache = new Map<string, ProteinResearchContext>();

/**
 * Returns true when the research context for this accession version is already
 * in the in-process cache. Used by the route to skip the NCBI fetch on cache hits.
 */
export function isResearchContextCached(accessionVersion: string): boolean {
  return researchContextCache.has(`researchcontext:protein:${accessionVersion}`);
}

// ── getProteinResearchContext ─────────────────────────────────────────────────

/**
 * Derive a ProteinResearchContext from already-fetched data. Makes ZERO new
 * network calls — the caller must supply the raw GenPept text.
 *
 * Cache: results are stored in `researchContextCache` keyed by
 * `researchcontext:protein:{proteinAccessionVersion}`. On a cache hit, the
 * supplied `genPeptText` is ignored and the cached result is returned immediately.
 *
 * Immutability: all derivation functions return new objects; none mutate their
 * inputs. The cached ProteinResearchContext is frozen (Object.freeze) to enforce
 * the Phase 5.4B immutability rule at runtime.
 *
 * @param genPeptText    Raw GenPept flat-file text (from fetchProteinDetail).
 *                       Ignored on cache hit — pass "" on a known cache hit.
 * @param proteinRecord  ProteinRecord (detail-enriched, with proteinName + molecularWeight).
 * @param transcriptRecord TranscriptRecord for the parent transcript.
 * @param geneRecord     GeneRecord for the parent gene.
 * @param normalizedQuery Phase R resolver output, or null when not available.
 */
export async function getProteinResearchContext(
  genPeptText: string,
  proteinRecord: ProteinRecord,
  transcriptRecord: TranscriptRecord,
  geneRecord: GeneRecord,
  normalizedQuery: NormalizedQuery | null
): Promise<ModuleResult<ProteinResearchContext>> {
  const startedAt = performance.now();
  const cacheKey = `researchcontext:protein:${proteinRecord.proteinAccessionVersion}`;

  // Cache hit — return immediately, genPeptText is ignored.
  const cached = researchContextCache.get(cacheKey);
  if (cached) {
    return buildModuleResult({
      module: "protein-research-context",
      status: "success",
      data: [cached],
      error: null,
      startedAt,
    });
  }

  try {
    // All derivation functions are pure — no network calls inside any of them.
    const context: ProteinResearchContext = Object.freeze({
      subject: proteinRecord,
      summary: deriveSummary(genPeptText),
      roleChips: deriveRoleChips(genPeptText),
      canonicalExplanation: deriveCanonicalExplanation(proteinRecord, transcriptRecord),
      resolutionConfidence: normalizedQuery
        ? mapResolutionConfidence(normalizedQuery.confidence, normalizedQuery.ambiguous)
        : "ambiguous",
      annotationConfidence: computeAnnotationConfidence(genPeptText, proteinRecord),
      biologicalImportance: deriveBiologicalImportance(geneRecord),
      relationships: buildRelationships(geneRecord, transcriptRecord, proteinRecord),
      researchNotesPlaceholder: null,
    });

    researchContextCache.set(cacheKey, context);

    return buildModuleResult({
      module: "protein-research-context",
      status: "success",
      data: [context],
      error: null,
      startedAt,
    });
  } catch (err) {
    return buildModuleResult({
      module: "protein-research-context",
      status: "error",
      data: [],
      error: toModuleError("RESEARCH_CONTEXT_DERIVATION_ERROR", err),
      startedAt,
    });
  }
}

// ── getProteinDetail ──────────────────────────────────────────────────────────

/**
 * Fetch and parse GenPept detail for a single protein, enriching a base record.
 *
 * Returns a ModuleResult containing one fully-enriched ProteinRecord (with
 * proteinName, molecularWeight, and length populated from the GenPept flat-file).
 *
 * Called only when the user explicitly expands a protein sub-panel.
 *
 * @param proteinAccessionVersion - e.g. "NP_000537.3"
 * @param baseRecord - The existing summary-level ProteinRecord to enrich.
 */
export async function getProteinDetail(
  proteinAccessionVersion: string,
  baseRecord: ProteinRecord
): Promise<ModuleResult<ProteinRecord>> {
  const startedAt = performance.now();

  try {
    const genPeptText = await fetchProteinDetail(proteinAccessionVersion);

    if (!genPeptText || genPeptText.trim().length === 0) {
      return buildModuleResult({
        module: "protein-explorer",
        status: "error",
        data: [],
        error: {
          code: "GENPEPT_EMPTY",
          message: `NCBI returned empty GenPept for ${proteinAccessionVersion}.`,
        },
        startedAt,
      });
    }

    const enriched = enrichWithDetail(baseRecord, genPeptText);

    return buildModuleResult({
      module: "protein-explorer",
      status: "success",
      data: [enriched],
      error: null,
      startedAt,
    });
  } catch (err) {
    return buildModuleResult({
      module: "protein-explorer",
      status: "error",
      data: [],
      error: toModuleError("PROTEIN_DETAIL_ERROR", err),
      startedAt,
    });
  }
}
