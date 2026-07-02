/**
 * types/transcript-record.ts — Transcript Explorer data model (Phase 5.3A)
 *
 * TranscriptRecord represents one RefSeq transcript annotated for a given NCBI Gene.
 * It is derived from the NCBI Gene EFetch gene_table response (rettype=gene_table),
 * supplemented by MANE Select / MANE Plus Clinical status from NCBI nuccore ESearch.
 *
 * Field provenance (confirmed by pre-code live API inspection — 2026-07-02):
 *
 *   Primary source — NCBI Gene EFetch gene_table (efetch.fcgi?db=gene&rettype=gene_table):
 *     accessionVersion, exonCount, transcriptLength (total annotated spliced exon length).
 *     transcriptType and isProteinCoding are derived deterministically from accessionVersion prefix.
 *
 *   MANE source (human / taxid 9606 only) — nuccore ESearch + ESummary:
 *     ESearch: "{{geneId}}[gene_id] AND MANE Select[Keyword]" → nuccore UIDs
 *     ESearch: "{{geneId}}[gene_id] AND MANE Plus Clinical[Keyword]" → nuccore UIDs
 *     ESummary: accessionversion field → match against gene_table accessions
 *     MANE is NEVER applied to non-human genes. isCanonical is null for non-human.
 *
 *   status: derived deterministically from accession prefix (no additional API call).
 *     NM_/NR_ → "Reviewed" (manually curated RefSeq). XM_/XR_ → "Predicted".
 *     nuccore ESummary status field returned null for all tested accessions.
 *
 * Accession prefix → transcriptType mapping (deterministic, no NCBI call):
 *   NM_  → "mRNA"            (curated mRNA)
 *   NR_  → "ncRNA"           (curated ncRNA)
 *   XM_  → "predicted_mRNA"  (computationally predicted mRNA)
 *   XR_  → "predicted_ncRNA" (computationally predicted ncRNA)
 *   other → "other"
 *
 * Phase 5.3B will add: FASTA download, CDS retrieval, per-transcript EFetch for
 * sequence data, protein linkage (NP_ accession from peptide commentary), and
 * full validation suite.
 */

// ─── TranscriptRecord ──────────────────────────────────────────────────────────

export interface TranscriptRecord {
  // ── Core identifiers ────────────────────────────────────────────────────────

  /**
   * NCBI transcript accession without version suffix.
   * Examples: "NM_000546", "NR_176326", "XM_030245922".
   */
  transcriptId: string;

  /**
   * Full versioned accession, e.g. "NM_000546.6".
   * This is the canonical reference for this specific transcript version.
   * Used to construct ncbiTranscriptUrl and to match against MANE accession lists.
   */
  accessionVersion: string;

  /**
   * Transcript type derived deterministically from the accession prefix.
   * - "mRNA"            → NM_  (curated RefSeq mRNA)
   * - "ncRNA"           → NR_  (curated RefSeq ncRNA)
   * - "predicted_mRNA"  → XM_  (computationally predicted mRNA)
   * - "predicted_ncRNA" → XR_  (computationally predicted ncRNA)
   * - "other"           → any other prefix not covered above
   */
  transcriptType: "mRNA" | "ncRNA" | "predicted_mRNA" | "predicted_ncRNA" | "other";

  /**
   * True when the transcript is protein-coding.
   * Derived deterministically from accession prefix:
   *   NM_ and XM_ → true (coding mRNA, curated or predicted)
   *   NR_ and XR_ → false (non-coding RNA, never protein-coding)
   *   other        → false (cannot determine without additional lookup)
   * Do NOT infer beyond what NCBI annotation provides.
   */
  isProteinCoding: boolean;

  // ── Gene linkage ─────────────────────────────────────────────────────────────

  /** NCBI Gene ID of the parent gene. Links back to GeneRecord.geneId. */
  geneId: string;

  /** Official symbol of the parent gene. Example: "TP53". */
  geneSymbol: string;

  /** Scientific name of the organism. Example: "Homo sapiens". */
  organism: string;

  // ── Transcript metadata (from gene_table EFetch) ─────────────────────────────

  /**
   * Total length of the annotated spliced exons in nucleotides (nt).
   * Source: "total annotated spliced exon length" field in gene_table.
   * Unit is ALWAYS "nt" — never "bp". null when not available.
   */
  transcriptLength: number | null;

  /**
   * Number of exons in this transcript.
   * Source: exon count field in gene_table.
   * null when not available.
   */
  exonCount: number | null;

  // ── RefSeq status (derived from accession prefix) ────────────────────────────

  /**
   * RefSeq review status of this transcript.
   * Derived deterministically from the accession prefix:
   *   NM_ → "Reviewed"  (manually curated, reviewed by NCBI staff)
   *   NR_ → "Reviewed"  (manually curated ncRNA)
   *   XM_ → "Predicted" (computationally predicted by automated pipeline)
   *   XR_ → "Predicted" (computationally predicted ncRNA)
   *   other → null      (cannot determine from prefix alone)
   *
   * Note: "Validated", "Provisional", "Inferred", and "Model" are valid NCBI
   * RefSeq status values but are not reliably returned from nuccore ESummary
   * (status field returned null in all tested cases). These values may be
   * populated in Phase 5.3B when per-transcript EFetch is added.
   */
  status: "Reviewed" | "Validated" | "Provisional" | "Predicted" | "Inferred" | "Model" | null;

  // ── MANE designation (human genes only) ──────────────────────────────────────

  /**
   * Whether this transcript is the MANE Select transcript for this gene.
   *
   * MANE (Matched Annotation from NCBI and EMBL-EBI) Select designates the single
   * best-supported transcript that represents the gene for clinical and research use.
   *
   * - true:  This IS the MANE Select transcript (human gene, confirmed via nuccore ESearch).
   * - null:  MANE Select does not apply to this gene's organism (non-human),
   *          OR MANE Select status could not be determined (API error/partial).
   *          NEVER set to false for non-human genes — absence of MANE is null, not false.
   *
   * IMPORTANT: Do NOT apply MANE logic to non-human genes. isCanonical must be null
   * for all transcripts of mouse, plant, or other non-human genes, even if one
   * transcript appears "more canonical" by other criteria.
   */
  isCanonical: boolean | null;

  /**
   * The MANE Select accession (with version) for this gene's MANE Select transcript.
   * Populated on ALL transcripts of a human gene when MANE Select is known —
   * not just on the MANE Select transcript itself.
   * null for non-human genes or when MANE Select is not found.
   * Example: "NM_000546.6" for human TP53.
   */
  maneSelectAccession: string | null;

  /**
   * Whether this transcript is designated MANE Plus Clinical for this gene.
   * MANE Plus Clinical transcripts are additional RefSeq transcripts clinically
   * relevant beyond the single MANE Select.
   * false for non-human genes (MANE does not apply).
   */
  manePlusClinical: boolean;

  // ── Source and links ─────────────────────────────────────────────────────────

  /** Always "ncbi-refseq". Documents the authoritative source. */
  sourceDatabase: "ncbi-refseq";

  /**
   * NCBI Nucleotide page URL for this transcript.
   * Pattern: https://www.ncbi.nlm.nih.gov/nuccore/{accessionVersion}
   */
  ncbiTranscriptUrl: string;
}

// ─── Derived helpers (used by parser) ─────────────────────────────────────────

/** Derive transcriptType from accession prefix. */
export function transcriptTypeFromAccession(
  accession: string
): TranscriptRecord["transcriptType"] {
  if (accession.startsWith("NM_")) return "mRNA";
  if (accession.startsWith("NR_")) return "ncRNA";
  if (accession.startsWith("XM_")) return "predicted_mRNA";
  if (accession.startsWith("XR_")) return "predicted_ncRNA";
  return "other";
}

/** Derive isProteinCoding from accession prefix. */
export function isProteinCodingFromAccession(accession: string): boolean {
  return accession.startsWith("NM_") || accession.startsWith("XM_");
}

/** Derive RefSeq status from accession prefix. */
export function refseqStatusFromAccession(
  accession: string
): TranscriptRecord["status"] {
  if (accession.startsWith("NM_") || accession.startsWith("NR_")) return "Reviewed";
  if (accession.startsWith("XM_") || accession.startsWith("XR_")) return "Predicted";
  return null;
}

/** Sort TranscriptRecord[] per Phase 5.3A display order:
 *  1. MANE Select first
 *  2. Curated (NM_, NR_) before predicted (XM_, XR_)
 *  3. Length descending within same type tier
 */
export function sortTranscripts(records: TranscriptRecord[]): TranscriptRecord[] {
  const typeTier = (t: TranscriptRecord["transcriptType"]): number => {
    switch (t) {
      case "mRNA":           return 0;
      case "ncRNA":          return 1;
      case "predicted_mRNA": return 2;
      case "predicted_ncRNA":return 3;
      default:               return 4;
    }
  };
  return [...records].sort((a, b) => {
    // MANE Select first
    if (a.isCanonical && !b.isCanonical) return -1;
    if (!a.isCanonical && b.isCanonical) return 1;
    // Then by type tier (curated before predicted)
    const tierDiff = typeTier(a.transcriptType) - typeTier(b.transcriptType);
    if (tierDiff !== 0) return tierDiff;
    // Then by length descending
    const aLen = a.transcriptLength ?? 0;
    const bLen = b.transcriptLength ?? 0;
    return bLen - aLen;
  });
}
