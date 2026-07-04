/**
 * lib/transcript/parser.ts — Parse NCBI gene_table text into TranscriptRecord[]
 *
 * Input: raw gene_table text from efetch.fcgi?db=gene&rettype=gene_table&retmode=text
 * Output: TranscriptRecord[] (unsorted — caller sorts via sortTranscripts())
 *
 * gene_table transcript line format (confirmed from live API inspection of TP53/Trp53):
 *   {type} transcript variant {N} {ACCESSION}.{VERSION}, {EXONS} exons,  total annotated spliced exon length: {LENGTH}
 *
 * Examples (TP53, Gene ID 7157):
 *   mRNA transcript variant 1 NM_000546.6, 11 exons,  total annotated spliced exon length: 2512
 *   RNA transcript variant 14 NR_176326.1, 10 exons,  total annotated spliced exon length: 2399
 *   mRNA transcript variant X2 XM_030245922.1, 12 exons,  total annotated spliced exon length: 1881
 *
 * Protein lines (used, not skipped, for NM_/XM_ transcripts):
 *   Immediately follow their transcript line, e.g.:
 *     "protein isoform g NP_001263690.1 (CCDS73969.1), 8 coding  exons, ..."
 *     "protein isoform i NP_001394198.1, 7 coding  exons, ..."
 *   The protein accession is parsed from this line and attached to the transcript
 *   record directly above it. Confirmed via live gene_table inspection (TP53, 2026-07-03):
 *   the protein line for a coding transcript is always the line immediately after it.
 *
 * Lines that are NOT transcript lines (skipped):
 *   - Exon table headers and coordinate lines
 *   - Gene header and annotation lines
 *   - Blank lines
 *
 * MANE Select / MANE Plus Clinical are NOT in gene_table — they come from
 * ManeInfo (fetchManeInfo) and are applied as a post-processing step.
 *
 * Deduplication: gene_table may list the same accession on multiple annotation
 * tracks (e.g. two genomic assemblies). Accessions are deduplicated by
 * accessionVersion — last occurrence wins (assembly tracks appear in order,
 * with primary assembly first).
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import {
  transcriptTypeFromAccession,
  accessionPrefixFromAccession,
  isProteinCodingFromAccession,
  refseqStatusFromAccession,
} from "@/types/transcript-record";
import type { ManeInfo } from "./fetch";

// ── Transcript line regex ─────────────────────────────────────────────────────
// Matches: {type} transcript variant {label} {ACC.VER}, {N} exons,  total annotated spliced exon length: {LEN}
// Groups:  [1]=accessionVersion [2]=exonCount [3]=transcriptLength
const TRANSCRIPT_LINE_RE =
  /^(?:mRNA|RNA|ncRNA|tRNA|rRNA|precursor_RNA|tmRNA|scRNA|snoRNA|snRNA|misc_RNA|miscRNA)\s+transcript\s+variant\s+\S+\s+(\S+),\s+(\d+)\s+exons,\s+total\s+annotated\s+spliced\s+exon\s+length:\s+(\d+)/i;

// ── Protein line regex ────────────────────────────────────────────────────────
// Matches: "protein isoform {label} {ACC.VER} (optional CCDS), {N} coding  exons, ..."
// Groups:  [1]=proteinAccessionVersion (NP_/XP_ only)
const PROTEIN_LINE_RE = /^protein\s+isoform\s+\S+\s+([NX]P_[\d.]+)/i;

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse raw gene_table text into an array of TranscriptRecord objects.
 *
 * @param text              Raw gene_table response text from NCBI EFetch
 * @param geneId            Parent gene's NCBI Gene ID
 * @param geneSymbol        Parent gene's official symbol
 * @param organism          Parent gene's organism scientific name
 * @param maneInfo          MANE Select / Plus Clinical accession data (human only)
 * @param isHuman           Whether this gene is from Homo sapiens (taxid 9606)
 * @returns                 Array of TranscriptRecord (unsorted)
 */
export function parseGeneTable(
  text: string,
  geneId: string,
  geneSymbol: string,
  organism: string,
  maneInfo: ManeInfo | null,
  isHuman: boolean
): TranscriptRecord[] {
  const lines = text.split("\n");

  // Collect parsed entries in a Map to deduplicate by accessionVersion
  const seen = new Map<string, TranscriptRecord>();

  // Build sets for O(1) lookup
  const maneSelectSet = new Set(maneInfo?.maneSelectAccessions ?? []);
  const manePlusSet = new Set(maneInfo?.manePlusClinicalAccessions ?? []);

  // Initial MANE Select accession estimate — used as a starting value only.
  // May be inaccurate when NCBI's "MANE Select[Keyword]" ESearch returns spurious
  // nuccore UIDs (confirmed for TP53 Gene ID 7157: NM_005940.5 appears in the
  // ESearch result even though it is not a TP53 transcript). The post-processing
  // step at the end of this function corrects the value using authoritative
  // record-level isCanonical data whenever exactly one canonical transcript is found.
  const maneSelectAccVer: string | null =
    isHuman && maneInfo && maneInfo.maneSelectAccessions.length > 0
      ? maneInfo.maneSelectAccessions[0]
      : null;

  for (let i = 0; i < lines.length; i++) {
    const match = TRANSCRIPT_LINE_RE.exec(lines[i].trim());
    if (!match) continue;

    const accessionVersion = match[1]; // e.g. "NM_000546.6"
    const exonCount = parseInt(match[2], 10);
    const transcriptLength = parseInt(match[3], 10);

    // Derive base accession (without version) — everything before the last "."
    const dotIdx = accessionVersion.lastIndexOf(".");
    const transcriptId =
      dotIdx >= 0 ? accessionVersion.slice(0, dotIdx) : accessionVersion;

    const transcriptType = transcriptTypeFromAccession(accessionVersion);
    const accessionPrefix = accessionPrefixFromAccession(accessionVersion);
    const isProteinCoding = isProteinCodingFromAccession(accessionVersion);
    const status = refseqStatusFromAccession(accessionVersion);

    // ── Protein accession (NM_/XM_ only) ────────────────────────────────────
    // The protein line for a coding transcript is always the line immediately
    // after its transcript line (confirmed via live gene_table inspection).
    let proteinAccession: string | null = null;
    let proteinAccessionVersion: string | null = null;
    if (accessionPrefix === "NM_" || accessionPrefix === "XM_") {
      const nextLine = (lines[i + 1] ?? "").trim();
      const proteinMatch = PROTEIN_LINE_RE.exec(nextLine);
      if (proteinMatch) {
        proteinAccessionVersion = proteinMatch[1];
        const pDot = proteinAccessionVersion.lastIndexOf(".");
        proteinAccession =
          pDot >= 0 ? proteinAccessionVersion.slice(0, pDot) : proteinAccessionVersion;
      }
      // else: proteinAccession stays null.
      // TODO Phase 5.4: fetch protein accession via ELink db=gene→db=protein
    }
    // NR_/XR_ (non-coding) — proteinAccession is always null, no TODO (ncRNA has no protein).

    // MANE logic: only for human genes
    let isCanonical: boolean | null = null;
    let manePlusClinical = false;

    if (isHuman) {
      // isCanonical: true only when this accession is the MANE Select
      // null when MANE info was unavailable (API error / partial)
      if (maneInfo !== null) {
        isCanonical = maneSelectSet.has(accessionVersion) ? true : false;
      } else {
        isCanonical = null; // MANE fetch failed — cannot determine
      }
      manePlusClinical = manePlusSet.has(accessionVersion);
    }
    // Non-human: isCanonical stays null, manePlusClinical stays false

    const record: TranscriptRecord = {
      transcriptId,
      accessionVersion,
      accessionPrefix,
      transcriptType,
      isProteinCoding,
      geneId,
      geneSymbol,
      organism,
      transcriptLength: isNaN(transcriptLength) ? null : transcriptLength,
      exonCount: isNaN(exonCount) ? null : exonCount,
      status,
      isCanonical,
      maneSelectAccession: maneSelectAccVer,
      manePlusClinical,
      proteinAccession,
      proteinAccessionVersion,
      sourceDatabase: "ncbi-refseq",
      ncbiTranscriptUrl: `https://www.ncbi.nlm.nih.gov/nuccore/${accessionVersion}`,
    };

    // Dedup: last occurrence wins (primary assembly annotation replaces alternate)
    seen.set(accessionVersion, record);
  }

  const records = Array.from(seen.values());

  // ── Post-process: correct maneSelectAccession using authoritative isCanonical data ──
  //
  // maneSelectAccVer (from maneSelectAccessions[0]) can be wrong when NCBI's
  // "MANE Select[Keyword]" ESearch returns spurious UIDs. Confirmed for TP53:
  // the ESearch returns a UID for NM_005940.5 (not a TP53 transcript) — it never
  // enters the gene_table and therefore never becomes a parsed record, but it
  // pollutes maneSelectAccessions and can push the correct NM_000546.6 to [1].
  //
  // Strategy: after all records are parsed with isCanonical assigned via
  // maneSelectSet.has(), find the unique canonical record (isCanonical=true).
  // If exactly ONE such record exists, use its accessionVersion as the definitive
  // maneSelectAccession on ALL records. This is safe because:
  //   - Only records from the gene_table can reach this point.
  //   - Spurious ESearch UIDs for other genes never appear in the gene_table.
  //   - If 0 canonical records: MANE Select not found in gene_table; leave as-is.
  //   - If >1 canonical records: genuinely ambiguous (NCBI data issue beyond this
  //     gene); leave as-is rather than arbitrarily overwriting.
  if (isHuman && maneInfo !== null) {
    const canonicalRecords = records.filter((r) => r.isCanonical === true);
    if (canonicalRecords.length === 1) {
      const correctAccVer = canonicalRecords[0].accessionVersion;
      if (correctAccVer !== maneSelectAccVer) {
        // Mutate each record — plain objects created in this function, safe to mutate.
        for (const r of records) {
          (r as { maneSelectAccession: string | null }).maneSelectAccession = correctAccVer;
        }
      }
    }
  }

  return records;
}
