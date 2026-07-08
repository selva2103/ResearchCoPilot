/**
 * types/protein-record.ts — ProteinRecord interface (Phase 5.4A)
 *
 * A ProteinRecord represents a single RefSeq protein isoform attached to a
 * parent TranscriptRecord. It is downstream of the Transcript Explorer only —
 * proteins are never resolved independently from a user query.
 *
 * Data sources:
 *   - Summary fields (accession, length, status, isCanonical):
 *       NCBI ESummary db=protein, batched across all proteins in a gene.
 *   - Detail fields (proteinName, molecularWeight):
 *       NCBI EFetch db=protein rettype=gp, fetched on-demand per protein.
 *
 * Immutability rule:
 *   ProteinRecord is immutable after creation. The `enrichWithDetail` parser
 *   function in lib/protein/parser.ts returns a NEW object rather than mutating
 *   the input — this mirrors the TranscriptRecord pattern and prevents stale-
 *   reference bugs in React state.
 */

/**
 * A single RefSeq protein isoform, nested under its parent TranscriptRecord.
 *
 * Fields are grouped into three layers:
 *   1. Core identity (from gene_table / TranscriptRecord — no new fetch)
 *   2. Summary metadata (from ESummary — batched on transcript-list expand)
 *   3. Detail metadata (from GenPept EFetch — on-demand when protein panel expands)
 */
export interface ProteinRecord {
  // ── Core identity ────────────────────────────────────────────────────────────

  /** Unversioned RefSeq protein accession, e.g. "NP_000537". */
  proteinAccession: string;

  /** Versioned RefSeq protein accession, e.g. "NP_000537.3". Used as the canonical identifier. */
  proteinAccessionVersion: string;

  /**
   * Documents that this protein's accession was derived directly from the
   * parent TranscriptRecord (gene_table parse), never independently resolved.
   * Always "transcript".
   */
  proteinAccessionVersionSource: "transcript";

  /** Source database. Always "ncbi-refseq" for this module. */
  sourceDatabase: "ncbi-refseq";

  /**
   * Protein status derived deterministically from the accession prefix:
   *   NP_ → "Reviewed"
   *   XP_ → "Predicted"
   *   anything else → "Other"
   */
  status: "Reviewed" | "Predicted" | "Other";

  /**
   * True only if this protein's parent transcript has isCanonical = true
   * (i.e. is the MANE Select transcript for a human gene).
   * null for non-human genes (MANE does not apply; never false for those organisms).
   * false for human genes that have a MANE Select transcript but this is not it.
   *
   * Inherited directly from TranscriptRecord.isCanonical — no independent logic.
   */
  isCanonical: boolean | null;

  /**
   * NCBI URL for this protein. Constructed as:
   *   https://www.ncbi.nlm.nih.gov/protein/{proteinAccessionVersion}
   */
  ncbiProteinUrl: string;

  // ── Traceability fields (from parent TranscriptRecord) ────────────────────────

  /** The parent transcript's unversioned accession, e.g. "NM_000546". */
  transcriptId: string;

  /** The parent gene's NCBI Gene ID, e.g. "7157". */
  geneId: string;

  /** The official gene symbol, e.g. "TP53". */
  geneSymbol: string;

  /** The organism scientific name, e.g. "Homo sapiens". */
  organism: string;

  // ── Summary metadata (populated from ESummary batch call) ─────────────────────

  /**
   * Amino acid sequence length. Sourced from ESummary `slen` field.
   * null when ESummary does not return a valid length.
   */
  length: number | null;

  /**
   * True if the protein's FASTA sequence is retrievable for this accession.
   * Set to false for retired or unavailable accessions (detected when slen === 0
   * or the accession is not found in ESummary), allowing the Download FASTA button
   * to be disabled upfront rather than discovering the failure on click.
   */
  sequenceAvailable: boolean;

  // ── Detail metadata (populated on-demand from GenPept EFetch) ─────────────────

  /**
   * Human-readable protein name, e.g. "cellular tumor antigen p53 isoform a".
   * Sourced from the /product= qualifier of the Protein feature in the GenPept record.
   * null until the detail fetch is performed (user expands the protein sub-panel).
   */
  proteinName?: string | null;

  /**
   * Calculated molecular weight in Daltons, e.g. 43522.
   * Sourced from the /calculated_mol_wt= qualifier in the GenPept Protein feature.
   * Optional — not guaranteed to be present. Omit entirely when null; never render
   * a placeholder or "undefined" in the UI.
   */
  molecularWeight?: number | null;
}

// ── Derivation helpers ─────────────────────────────────────────────────────────

/**
 * Derive the protein status from the accession prefix.
 *   NP_ → "Reviewed"
 *   XP_ → "Predicted"
 *   anything else → "Other"
 */
export function proteinStatusFromAccession(
  accession: string
): ProteinRecord["status"] {
  if (accession.startsWith("NP_")) return "Reviewed";
  if (accession.startsWith("XP_")) return "Predicted";
  return "Other";
}
