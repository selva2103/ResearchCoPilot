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
 * Lines that are NOT transcript lines (skipped):
 *   - Protein lines: "protein isoform a NP_000537.3 ..."
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
  isProteinCodingFromAccession,
  refseqStatusFromAccession,
} from "@/types/transcript-record";
import type { ManeInfo } from "./fetch";

// ── Transcript line regex ─────────────────────────────────────────────────────
// Matches: {type} transcript variant {label} {ACC.VER}, {N} exons,  total annotated spliced exon length: {LEN}
// Groups:  [1]=accessionVersion [2]=exonCount [3]=transcriptLength
const TRANSCRIPT_LINE_RE =
  /^(?:mRNA|RNA|ncRNA|tRNA|rRNA|precursor_RNA|tmRNA|scRNA|snoRNA|snRNA|misc_RNA|miscRNA)\s+transcript\s+variant\s+\S+\s+(\S+),\s+(\d+)\s+exons,\s+total\s+annotated\s+spliced\s+exon\s+length:\s+(\d+)/i;

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

  // Determine MANE Select accession (first NM_ in the list, if any)
  const maneSelectAccVer =
    isHuman && maneInfo && maneInfo.maneSelectAccessions.length > 0
      ? maneInfo.maneSelectAccessions[0]
      : null;

  // Build sets for O(1) lookup
  const maneSelectSet = new Set(maneInfo?.maneSelectAccessions ?? []);
  const manePlusSet = new Set(maneInfo?.manePlusClinicalAccessions ?? []);

  for (const line of lines) {
    const match = TRANSCRIPT_LINE_RE.exec(line.trim());
    if (!match) continue;

    const accessionVersion = match[1]; // e.g. "NM_000546.6"
    const exonCount = parseInt(match[2], 10);
    const transcriptLength = parseInt(match[3], 10);

    // Derive base accession (without version) — everything before the last "."
    const dotIdx = accessionVersion.lastIndexOf(".");
    const transcriptId =
      dotIdx >= 0 ? accessionVersion.slice(0, dotIdx) : accessionVersion;

    const transcriptType = transcriptTypeFromAccession(accessionVersion);
    const isProteinCoding = isProteinCodingFromAccession(accessionVersion);
    const status = refseqStatusFromAccession(accessionVersion);

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
      sourceDatabase: "ncbi-refseq",
      ncbiTranscriptUrl: `https://www.ncbi.nlm.nih.gov/nuccore/${accessionVersion}`,
    };

    // Dedup: last occurrence wins (primary assembly annotation replaces alternate)
    seen.set(accessionVersion, record);
  }

  return Array.from(seen.values());
}
