/**
 * lib/protein/index.ts — Protein Explorer module orchestrator (Phase 5.4A)
 *
 * Public API:
 *   getProteinsForTranscripts(transcripts) → Promise<ModuleResult<ProteinRecord>>
 *     Filters to coding transcripts with a non-null proteinAccessionVersion,
 *     fetches ESummary for all of them in a single NCBI call, and returns
 *     one ProteinRecord per transcript (in the same order as the input array).
 *
 *   getProteinDetail(proteinAccessionVersion, baseRecord) → Promise<ModuleResult<ProteinRecord>>
 *     Fetches GenPept for a single protein and returns the enriched ProteinRecord.
 *     Called only when the user expands a specific protein sub-panel.
 *
 * NCBI call accounting for Phase 5.4A:
 *   getProteinsForTranscripts: 1 call (batched ESummary — regardless of gene size)
 *   getProteinDetail:          1 call (single GenPept EFetch — on-demand)
 *   FASTA download:            1 call (single FASTA EFetch — via download route)
 *
 * Redis cache keys (documented for Phase 5.4B activation):
 *   protein:summary:{proteinAccessionVersion}
 *   protein:detail:{proteinAccessionVersion}
 *   protein:fasta:{proteinAccessionVersion}
 *   TTL: ≥ 86400s (protein records are immutable once versioned)
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import type { ProteinRecord } from "@/types/protein-record";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";
import { fetchProteinSummaries, fetchProteinDetail } from "./fetch";
import { parseProteinSummary, enrichWithDetail } from "./parser";

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
