/**
 * types/variant-record.ts — Variant domain contracts (Phase 5.5A)
 *
 * VariantRecord represents a single ClinVar variant entry at the identity level.
 * It intentionally EXCLUDES clinical interpretation, conflict analysis, population
 * frequency, and aggregate clinical assertions — those belong to 5.5B's
 * ClinicalEvidence type.
 *
 * Field provenance (confirmed by pre-code live ClinVar ESummary inspection — 2026-07-11):
 *
 *   All fields derive from ClinVar ESummary (db=clinvar, retmode=json):
 *     clinvarVariationId  ← esummary.uid
 *     clinvarAccession    ← esummary.accession (VCV format)
 *     dbsnpId             ← esummary.variation_set[0].variation_xrefs[dbSNP].db_id
 *     geneId / geneSymbol ← esummary.genes[0].geneid / .symbol
 *     organism            ← always "Homo sapiens" for ClinVar (human-centric database)
 *     variantType         ← esummary.obj_type (as provided, never remapped)
 *     genomicHgvs         ← null — see LIMITATION below
 *     transcriptConsequences ← parsed from esummary.variation_set[0].variation_name
 *                               (one representative entry only — see LIMITATION below)
 *
 * LIMITATION — single transcript consequence:
 *   ClinVar ESummary provides ONE representative transcript consequence via
 *   `variation_set[0].variation_name` (e.g., "NM_000546.6(TP53):c.524G>A (p.Arg175His)").
 *   The `protein_change` field lists multiple protein-level changes without transcript
 *   accessions. ClinVar EFetch (rettype=vcv) returns an empty XML set and cannot be used
 *   to retrieve per-transcript consequence details via EUtils.
 *   Result: transcriptConsequences contains 0 or 1 entries only in Phase 5.5A.
 *   Full multi-transcript detail is a known 5.5B enhancement.
 *
 * LIMITATION — genomicHgvs:
 *   ESummary provides `canonical_spdi` (SPDI format, e.g., "NC_000017.11:7675087:C:T"),
 *   NOT a genomic HGVS string. Converting SPDI to HGVS (NC_000017.11:g.7675088C>T) is
 *   trivial for SNVs but complex for indels and must not be done heuristically.
 *   genomicHgvs is always null in Phase 5.5A. The SPDI is NOT stored on VariantRecord
 *   to avoid misrepresenting it as HGVS. Phase 5.5B may add a `canonicalSpdi` field.
 *
 * 5.5B handoff:
 *   - ClinicalEvidence (5.5B) will attach to VariantRecord via clinvarVariationId
 *   - RCV accessions (supporting_submissions.rcv) link to condition-level assertions
 *   - SCV accessions (supporting_submissions.scv) link to individual submitter assertions
 *   - germline_classification.description and review_status belong to ClinicalEvidence
 *   - Population frequency (gnomAD) is explicitly out of scope for both 5.5A and 5.5B
 *     per the non-negotiable architectural constraints
 */

// ─── VariantTranscriptConsequence ─────────────────────────────────────────────

/**
 * A single transcript-level consequence for a variant.
 *
 * Parsed from ClinVar ESummary `variation_set[0].variation_name`:
 *   Format: "{transcript}({symbol}):{hgvsCoding} ({hgvsProtein})"
 *   Example: "NM_000546.6(TP53):c.524G>A (p.Arg175His)"
 *
 * Parsing rules:
 *   - transcriptAccession: leading NM_/NR_/XM_/XR_ accession (with version)
 *   - hgvsCoding: text after the first ":" (e.g., "c.524G>A")
 *   - hgvsProtein: content of the trailing parenthetical (e.g., "p.Arg175His")
 *   - proteinAccession: NOT present in ESummary variation_name; always null in 5.5A
 *   - isCanonical: null — cannot be determined from ESummary alone without a separate
 *                  cross-reference to the MANE Select transcript (prohibited fabrication)
 *
 * Failure handling: if parsing fails for any field, that field is null.
 * If the entire variation_name cannot be parsed, no consequence entry is created
 * (transcriptConsequences stays empty) — never a fabricated placeholder.
 */
export interface VariantTranscriptConsequence {
  /** RefSeq transcript accession with version. Example: "NM_000546.6" */
  transcriptAccession: string;

  /**
   * HGVS coding notation, transcript-relative.
   * Example: "c.524G>A"
   * null when not parseable from variation_name.
   */
  hgvsCoding: string | null;

  /**
   * RefSeq protein accession with version.
   * NOT present in ClinVar ESummary variation_name.
   * Always null in Phase 5.5A.
   */
  proteinAccession: string | null;

  /**
   * HGVS protein notation.
   * Example: "p.Arg175His"
   * null when variant has no protein consequence (e.g., synonymous, non-coding),
   * or when not parseable from variation_name.
   */
  hgvsProtein: string | null;

  /**
   * Whether this is the canonical (MANE Select) transcript.
   * null in Phase 5.5A — ESummary does not provide a reliable canonical flag.
   * Phase 5.5B may populate this by cross-referencing the existing transcript chain.
   * Never false-positive: if uncertain, null is always correct.
   */
  isCanonical: boolean | null;
}

// ─── VariantRecord ─────────────────────────────────────────────────────────────

/**
 * A single ClinVar variant at the identity/foundation level.
 * Contains only what ClinVar ESummary provides — no clinical assertions (5.5B).
 */
export interface VariantRecord {
  /** Always "clinvar" — documents the authoritative source database. */
  source: "clinvar";

  /**
   * ClinVar numeric Variation ID.
   * Corresponds to ESummary `uid`. Example: "12374"
   * This is the stable key used for cache keying, detail retrieval, and 5.5B links.
   */
  clinvarVariationId: string;

  /**
   * ClinVar VCV accession (Variant-level accession).
   * Example: "VCV000012374"
   * null when accession field is absent or malformed.
   */
  clinvarAccession: string | null;

  /**
   * dbSNP rsID (digits only, without "rs" prefix) extracted from variation_xrefs.
   * Example: "28934578" (for rs28934578)
   * null when no dbSNP cross-reference is present.
   */
  dbsnpId: string | null;

  /**
   * NCBI Gene ID. Example: "7157" for TP53.
   * Source: ESummary genes[0].geneid
   */
  geneId: string;

  /**
   * Gene symbol. Example: "TP53"
   * Source: ESummary genes[0].symbol
   */
  geneSymbol: string;

  /**
   * Organism. Always "Homo sapiens" for ClinVar records.
   * ClinVar is a human-centric database; non-human variants are not in scope.
   */
  organism: string;

  /**
   * Variant type as provided by ClinVar — never inferred or remapped.
   * Example: "single nucleotide variant", "Indel", "deletion"
   * Source: ESummary obj_type
   * null when obj_type is absent or empty.
   */
  variantType: string | null;

  /**
   * Genomic HGVS notation.
   * Always null in Phase 5.5A — ESummary provides canonical_spdi (SPDI format),
   * not genomic HGVS. Converting SPDI→HGVS heuristically is prohibited.
   * Phase 5.5B may add canonicalSpdi if the SPDI string proves useful.
   */
  genomicHgvs: string | null;

  /**
   * Representative title from ClinVar.
   * Source: ESummary title (e.g., "NM_000546.6(TP53):c.524G>A (p.Arg175His)")
   * Useful for display in list rows; same as variation_name in most cases.
   */
  title: string | null;

  /**
   * Transcript-level consequences for this variant.
   *
   * Phase 5.5A limitation: contains 0 or 1 entries only (parsed from
   * ESummary variation_name — the representative transcript consequence).
   * Multiple transcript consequences require ClinVar VCV XML, which is
   * not retrievable via EUtils EFetch in 2026 (rettype=vcv returns empty).
   *
   * Empty when variation_name is absent or unparseable.
   * Never a fabricated entry.
   */
  transcriptConsequences: readonly VariantTranscriptConsequence[];

  /**
   * Consequence type labels from ClinVar.
   * Example: ["missense variant", "3 prime UTR variant"]
   * Source: ESummary molecular_consequence_list
   * Provided as-is from the source; not used to populate transcriptConsequences.
   */
  molecularConsequences: readonly string[];

  /** Always "clinvar". */
  sourceDatabase: "clinvar";
}

// ─── Variant list filter/sort options ────────────────────────────────────────

/**
 * Clinical significance filter values supported by ClinVar ESearch.
 * Confirmed by live API audit (2026-07-11).
 */
export type ClinVarSignificanceFilter =
  | "pathogenic"
  | "likely pathogenic"
  | "benign"
  | "likely benign"
  | "uncertain significance";

/**
 * Variant type filter values supported by ClinVar ESearch.
 * Values match ClinVar's `obj_type` vocabulary (case-sensitive for NCBI).
 */
export type ClinVarVariantTypeFilter =
  | "single nucleotide variant"
  | "deletion"
  | "insertion"
  | "indel"
  | "duplication";

/**
 * Sort options for ClinVar variant retrieval.
 * Only `relevance` produces a distinct ordering from the default (NCBI default =
 * most recent by Variation ID). Clinical significance sorting is NOT supported
 * server-side (confirmed by live API audit).
 */
export type ClinVarSortOption = "default" | "relevance";

/**
 * Options for fetching a paginated variant list for a gene.
 */
export interface VariantListOptions {
  /** Zero-based offset. Default: 0. */
  offset?: number;
  /** Records per page. Default: 20, max: 100. */
  pageSize?: number;
  /** Clinical significance filter. null = no filter. */
  significanceFilter?: ClinVarSignificanceFilter | null;
  /** Variant type filter. null = no filter. */
  variantTypeFilter?: ClinVarVariantTypeFilter | null;
  /** Sort order. Default: "default" (NCBI default order). */
  sort?: ClinVarSortOption;
}
