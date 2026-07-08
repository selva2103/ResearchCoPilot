/**
 * lib/protein/parser.ts — Protein record parsers (Phase 5.4A)
 *
 * Two pure functions:
 *   parseProteinSummary(summaryEntry, transcriptRecord) → ProteinRecord
 *     Builds a ProteinRecord from one ESummary entry, inheriting traceability
 *     fields from the parent TranscriptRecord.
 *
 *   enrichWithDetail(proteinRecord, genPeptText) → ProteinRecord
 *     Returns a NEW ProteinRecord with proteinName, molecularWeight, and length
 *     merged in from the GenPept flat-file. Immutable — never mutates input.
 *
 * GenPept field locations (confirmed live for NP_000537.3):
 *   LOCUS line:  "LOCUS       NP_000537  393 aa  linear  PRI  ..."
 *     → length = 393 (second numeric token on LOCUS line, before " aa")
 *   FEATURES > Protein feature > /product= qualifier:
 *     → proteinName = "cellular tumor antigen p53 isoform a"
 *   FEATURES > Protein feature > /calculated_mol_wt= qualifier:
 *     → molecularWeight = 43522 (integer, Daltons)
 *     Note: /calculated_mol_wt is OPTIONAL — not present on all proteins.
 *           Model as number | null, omit in UI when null.
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import type { ProteinRecord } from "@/types/protein-record";
import { proteinStatusFromAccession } from "@/types/protein-record";
import type { ProteinSummaryEntry } from "./fetch";

// ── parseProteinSummary ───────────────────────────────────────────────────────

/**
 * Build a ProteinRecord from an ESummary entry and its parent TranscriptRecord.
 *
 * isCanonical is inherited directly from transcriptRecord.isCanonical:
 *   - Human gene, MANE Select transcript → true
 *   - Human gene, non-MANE transcript    → false
 *   - Non-human gene                     → null
 * No independent canonical logic is applied.
 *
 * proteinName and molecularWeight are null until enriched via enrichWithDetail.
 */
export function parseProteinSummary(
  entry: ProteinSummaryEntry,
  transcript: TranscriptRecord
): ProteinRecord {
  const accVer = entry.accessionversion; // e.g. "NP_000537.3"
  const accBase = entry.caption;         // e.g. "NP_000537"
  const lengthAa = typeof entry.slen === "number" && entry.slen > 0
    ? entry.slen
    : null;

  return {
    // Core identity
    proteinAccession: accBase,
    proteinAccessionVersion: accVer,
    proteinAccessionVersionSource: "transcript",
    sourceDatabase: "ncbi-refseq",
    status: proteinStatusFromAccession(accBase),
    isCanonical: transcript.isCanonical,
    ncbiProteinUrl: `https://www.ncbi.nlm.nih.gov/protein/${accVer}`,

    // Traceability (from parent TranscriptRecord)
    transcriptId: transcript.transcriptId,
    geneId: transcript.geneId,
    geneSymbol: transcript.geneSymbol,
    organism: transcript.organism,

    // Summary metadata
    length: lengthAa,
    sequenceAvailable: lengthAa !== null,

    // Detail fields — not yet fetched
    proteinName: null,
    molecularWeight: null,
  };
}

// ── enrichWithDetail ──────────────────────────────────────────────────────────

// Regex patterns for GenPept flat-file parsing.

/**
 * LOCUS line: "LOCUS       NP_000537  393 aa  linear  ..."
 * Captures the amino acid count before " aa".
 */
const LOCUS_LENGTH_RE = /^LOCUS\s+\S+\s+(\d+)\s+aa\b/m;

/**
 * /product= qualifier within FEATURES > Protein.
 * Captures the product name (may be quoted on one line, or multi-line continuation).
 * This regex handles the single-line case; multi-line is handled by the function below.
 */
const PRODUCT_RE = /\/product="([^"]+)"/;

/**
 * /calculated_mol_wt= qualifier (integer, no quotes).
 * Captures the molecular weight value in Daltons.
 * Optional — not present on all GenPept records.
 */
const MOL_WT_RE = /\/calculated_mol_wt=(\d+)/;

/**
 * Merge proteinName, molecularWeight, and length from a GenPept flat-file text
 * into an existing ProteinRecord.
 *
 * Returns a NEW ProteinRecord (immutable — does not mutate the input).
 * Fields that cannot be parsed are left at their previous values.
 *
 * @param record     The base ProteinRecord from parseProteinSummary.
 * @param genPeptText  Raw GenPept flat-file text from fetchProteinDetail.
 */
export function enrichWithDetail(
  record: ProteinRecord,
  genPeptText: string
): ProteinRecord {
  // ── Parse protein name from /product= qualifier ───────────────────────────
  let proteinName: string | null = null;
  const productMatch = PRODUCT_RE.exec(genPeptText);
  if (productMatch) {
    // The /product= qualifier may span multiple continuation lines.
    // Continuation lines start with whitespace + value (no qualifier key).
    // We capture the full value by scanning forward from the match position.
    const rawValue = extractMultiLineQualifier(genPeptText, productMatch.index);
    if (rawValue) {
      // Strip [Organism] suffix appended in DEFINITION line, if leaked in.
      proteinName = rawValue.replace(/\s+\[[^\]]+\]$/, "").trim() || null;
    } else {
      proteinName = productMatch[1].trim() || null;
    }
  }

  // ── Parse molecular weight from /calculated_mol_wt= ───────────────────────
  let molecularWeight: number | null = null;
  const molWtMatch = MOL_WT_RE.exec(genPeptText);
  if (molWtMatch) {
    const parsed = parseInt(molWtMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) molecularWeight = parsed;
  }

  // ── Parse length from LOCUS line ──────────────────────────────────────────
  let length: number | null = record.length;
  const locusMatch = LOCUS_LENGTH_RE.exec(genPeptText);
  if (locusMatch) {
    const parsed = parseInt(locusMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) length = parsed;
  }

  // Return a new immutable record with merged detail fields.
  return {
    ...record,
    proteinName,
    molecularWeight,
    length,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract the full value of a potentially multi-line GenBank/GenPept qualifier.
 *
 * GenPept qualifiers like /product= may wrap across lines:
 *   /product="cellular tumor antigen p53 isoform a"   (single line — common)
 *   /product="some very long
 *             name that wraps"                         (multi-line — rare)
 *
 * This function reads from the opening `"` to the closing `"`, collecting
 * continuation text. Returns null if the closing quote cannot be found.
 *
 * @param text       Full GenPept flat-file text.
 * @param matchIndex Character index where the /product= match begins.
 */
function extractMultiLineQualifier(text: string, matchIndex: number): string | null {
  const openQuote = text.indexOf('"', matchIndex);
  if (openQuote === -1) return null;
  const closeQuote = text.indexOf('"', openQuote + 1);
  if (closeQuote === -1) return null;
  // Collapse internal whitespace (newlines + indentation in continuation lines).
  return text
    .slice(openQuote + 1, closeQuote)
    .replace(/\s+/g, " ")
    .trim();
}
