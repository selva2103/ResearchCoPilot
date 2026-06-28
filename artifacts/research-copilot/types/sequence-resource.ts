/**
 * SequenceResource — generic biological sequence resource model.
 *
 * This type is intentionally NOT GenBank-specific. It is the canonical
 * data model for the unified Sequence Layer, designed to be populated by
 * multiple future providers:
 *
 *   Phase 5.1:  GenBank / NCBI nucleotide pipeline (this phase)
 *   Phase 5.2+: Gene → mRNA → CDS → Protein expansion
 *   Future:     ENA, SRA, UniProt, AlphaFold, KEGG, Reactome
 *
 * Fields are documented with which Rule (1/2/3) produces them.
 * Never add provider-specific names to this interface — add new optional
 * fields with a `// provider:` comment indicating which provider populates them.
 */

/**
 * Identifier namespace for resourceIdentifier.
 * Extend this union as new providers are added — do NOT hardcode to NCBI values.
 *
 * "ncbi-refseq"   — NCBI RefSeq accession (NC_, NG_, NM_, NP_, GCF_, etc.)
 * "ncbi-genbank"  — NCBI GenBank/INSDC accession (AY_, MN_, GCA_, etc.)
 * "uniprot"       — UniProt accession (future Phase 5.x)
 * "ena"           — European Nucleotide Archive accession (future Phase 5.x)
 * "sra"           — NCBI SRA run accession (future Phase 5.x)
 */
export type IdentifierScheme =
  | "ncbi-refseq"
  | "ncbi-genbank"
  | "uniprot"
  | "ena"
  | "sra"
  | string; // extensible for future providers without a breaking type change

/**
 * Biological category of the sequence resource.
 *
 * Rule-to-resourceCategory mapping (Phase 5.1):
 *   Rule 1 (accession lookup):   Genome | Gene | Chromosome | Contig | Plasmid
 *   Rule 2 (organism/assembly):  Genome | Chromosome | Plasmid | Contig
 *   Rule 3 (gene symbol):        Gene
 *
 * Future phases will produce Transcript and Protein via the availableResources expansion.
 */
export type ResourceCategory =
  | "Genome"
  | "Gene"
  | "Transcript"
  | "Protein"
  | "Assembly"
  | "Chromosome"
  | "Plasmid"
  | "Contig";

/**
 * Unit for sequenceLength.
 *
 * Derivation rule (always computed from resourceCategory — never set independently):
 *   Protein                                           → "aa"
 *   Genome | Gene | Transcript | Chromosome | Contig  → "bp" for DNA, "nt" for RNA
 *   Plasmid | Assembly                                → "bp"
 *
 * NCBI nuccore ESummary uses `slen` (integer) and `moltype` ("dna" | "rna") to determine
 * the correct unit. Assembly ESummary uses `meta` Stats for total sequence length in bp.
 */
export type SequenceLengthUnit = "bp" | "nt" | "aa";

/**
 * Reference or curation status of this sequence resource.
 *
 * Values map directly to NCBI's own designations:
 *   "reference genome"      — NCBI-flagged reference genome (refseq_category = "reference genome")
 *   "representative genome" — NCBI-flagged representative genome
 *   "other assembly"        — An assembly exists but without reference/representative status
 *   "refseq-gene"           — RefSeq Gene record (NG_ accession), Rule 3 gene-symbol path
 *   "refseq-chromosome"     — RefSeq chromosome record (NC_ accession), Rule 1/2 chromosome path
 *   "no-refseq"             — GenBank-only record; no RefSeq equivalent was found (Rule 1 fallback)
 */
export type ReferenceStatus =
  | "reference genome"
  | "representative genome"
  | "other assembly"
  | "refseq-gene"
  | "refseq-chromosome"
  | "no-refseq";

/**
 * A single downloadable file associated with a SequenceResource.
 * Phase 5.1 supports: Genome FASTA, GenBank Flat File, Feature Table.
 * NOT implemented in Phase 5.1: Protein FASTA, Gene FASTA, CDS FASTA.
 */
export interface SequenceDownload {
  /** Human-readable name, e.g. "Genome FASTA" */
  name: string;
  /** File format, e.g. "fasta", "genbank", "feature-table" */
  format: "fasta" | "genbank" | "feature-table";
  /** Direct HTTPS URL — verified to return HTTP 200 before inclusion */
  url: string;
  /** True when the URL was verified during this request. False if constructed from pattern. */
  verified: boolean;
  /** File size hint, if known (e.g. "4.4 MB"). Absent when not available from NCBI. */
  size?: string;
}

/**
 * An available (but not yet fetched) biological resource type.
 *
 * Used to declare what COULD be retrieved in future phases without actually
 * downloading or enumerating it in Phase 5.1.
 *
 * The `provider` field identifies which module/integration is responsible
 * for expanding this resource in a future phase. The frontend uses this to
 * progressively reveal deeper biological resources without changing the architecture.
 *
 * Examples (Phase 5.1):
 *   { type: "Genome",   available: true,  provider: "ncbi-genbank",   expandable: true  }
 *   { type: "Genes",    available: true,  estimatedCount: 4392, provider: "ncbi-gene", expandable: true }
 *   { type: "mRNA",     available: true,  provider: "ncbi-refseq",   expandable: false } // Phase 5.2+
 *   { type: "Proteins", available: true,  provider: "uniprot",       expandable: false } // future
 *   { type: "Raw Reads",available: false, provider: "ncbi-sra",      expandable: false } // future
 */
export interface AvailableResource {
  /** The biological resource type */
  type:
    | "Genome"
    | "Genes"
    | "mRNA"
    | "CDS"
    | "Proteins"
    | "Raw Reads"
    | "Genome Assembly"
    | string;
  /** Whether at least one record of this type is known to exist */
  available: boolean;
  /**
   * Approximate count of records of this type, if obtainable without a full fetch.
   * For genes: from NCBI genome annotation stats. For proteins: from UniProt entry count.
   * Absent when not determinable without a full downstream query.
   */
  estimatedCount?: number;
  /**
   * Whether the frontend can expand this resource via a future Load More / Explore action.
   * True only when a concrete module exists (or is planned) to serve it.
   * Set to false for integrations planned but not yet implemented.
   */
  expandable: boolean;
  /**
   * Which database or integration serves this resource.
   * Examples: "ncbi-genbank", "ncbi-refseq", "ncbi-gene", "ncbi-sra", "uniprot", "alphafold"
   */
  provider: string;
}

/**
 * The primary data model for the unified Sequence Layer.
 *
 * Fields are grouped into: identity, classification, organism, assembly,
 * sequence attributes, provenance, downloads, and future-expansion hooks.
 */
export interface SequenceResource {
  // ── Identity ──────────────────────────────────────────────────────────────

  /**
   * Human-readable accession string for display, e.g. "GCF_000195955.2" or "NC_045512.2".
   * May be an assembly accession (GCF_/GCA_) or a sequence accession (NC_, NG_, NM_, etc.).
   * For programmatic lookup, prefer resourceIdentifier + identifierScheme.
   */
  primaryAccession: string;

  /**
   * Canonical identifier value for programmatic use.
   * Paired with identifierScheme to form an unambiguous cross-provider key.
   * Example: "NC_045512.2" paired with identifierScheme "ncbi-refseq".
   *
   * Unlike primaryAccession (display field), this is what cross-provider lookup
   * logic and future ENA/UniProt/SRA integrations should use as the join key.
   */
  resourceIdentifier: string;

  /**
   * Which identifier namespace resourceIdentifier belongs to.
   * "ncbi-refseq" when the record is from NCBI RefSeq (NC_, NG_, GCF_ accessions).
   * "ncbi-genbank" when from NCBI GenBank/INSDC (AY_, MN_, GCA_ accessions).
   * Extensible — add new values as future providers are integrated.
   */
  identifierScheme: IdentifierScheme;

  // ── Classification ────────────────────────────────────────────────────────

  /**
   * Biological category of this resource.
   * Determines which Rule (1/2/3) resolution path was taken:
   *   Rule 3 → "Gene"
   *   Rule 2 → "Genome" | "Chromosome" | "Plasmid" | "Contig"
   *   Rule 1 → any value, depending on the accession type
   *
   * Future phases key off this field to route into the appropriate explorer UI.
   */
  resourceCategory: ResourceCategory;

  /**
   * Reference or curation status, per Rules 1/2.
   * For Rule 3 gene-symbol queries → "refseq-gene".
   * For Rule 2 organism queries → "reference genome" | "representative genome" | "other assembly".
   * For Rule 1 GenBank accession with no RefSeq equivalent → "no-refseq".
   */
  referenceStatus: ReferenceStatus;

  // ── Organism / Taxonomy ───────────────────────────────────────────────────

  /** Scientific name of the organism, e.g. "Mycobacterium tuberculosis H37Rv" */
  organism?: string;

  /** NCBI Taxonomy ID, e.g. 83332 for Mycobacterium tuberculosis H37Rv */
  taxId?: number;

  // ── Assembly ──────────────────────────────────────────────────────────────

  /**
   * Assembly name, e.g. "ASM19595v2" or "TAIR10.1".
   * From NCBI assembly ESummary `assemblyname` field.
   */
  assemblyName?: string;

  /**
   * Assembly level: "Complete Genome", "Chromosome", "Scaffold", "Contig".
   * From NCBI assembly ESummary `assemblystatus` field.
   * Note: the assembly ESummary field is `assemblystatus`, NOT `assemblylevel` (which is null).
   */
  assemblyLevel?: string;

  /**
   * The corresponding GenBank assembly accession (GCA_...) if the primary is RefSeq (GCF_).
   * From the `synonym.genbank` field in assembly ESummary.
   * Absent when the primary IS the GenBank accession or when no synonym exists.
   */
  genbankAccession?: string;

  /**
   * The corresponding RefSeq assembly accession (GCF_...) if available.
   * From the `synonym.refseq` field in assembly ESummary.
   * Populated even when the primary is a GenBank accession, to surface the RefSeq equivalent.
   */
  refseqAccession?: string;

  // ── Sequence Attributes ───────────────────────────────────────────────────

  /** Human-readable description / definition line, e.g. "Mycobacterium tuberculosis H37Rv complete genome" */
  description?: string;

  /** INSDC molecule type: "dna" | "rna" | "ss-rna" | etc. From nuccore ESummary `moltype`. */
  moleculeType?: string;

  /** Topology: "linear" | "circular". From nuccore ESummary `topology`. */
  topology?: string;

  /**
   * Total sequence length.
   * Always paired with sequenceLengthUnit — never set one without the other.
   * Derived from NCBI `slen` (nuccore) or `meta` Stats total length (assembly).
   */
  sequenceLength?: number;

  /**
   * Unit for sequenceLength. Derived from resourceCategory and moltype:
   *   Protein → "aa"
   *   DNA sequences → "bp"
   *   RNA sequences → "nt"
   * NEVER set independently from sequenceLength.
   */
  sequenceLengthUnit?: SequenceLengthUnit;

  // ── Provenance / Dates ────────────────────────────────────────────────────

  /** Source database: "refseq" | "insd" (GenBank/INSDC). From nuccore ESummary `sourcedb`. */
  sourceDatabase?: string;

  /** Date first submitted to NCBI, ISO format e.g. "2013-02-01". */
  submissionDate?: string;

  /** Date last updated, ISO format e.g. "2026-06-17". */
  lastUpdateDate?: string;

  /** Sequence version, e.g. 2 for NC_045512.2 */
  sequenceVersion?: number;

  // ── Downloads ─────────────────────────────────────────────────────────────

  /**
   * Verified download links for this phase.
   * Phase 5.1: Genome FASTA, GenBank Flat File, Feature Table only.
   * NOT included: Protein FASTA, Gene FASTA, CDS FASTA (Phase 5.2+).
   */
  downloads: SequenceDownload[];

  // ── Future expansion ──────────────────────────────────────────────────────

  /**
   * Biological resource types available for this entity, without fully fetching them.
   *
   * Phase 5.1 populates availability metadata only:
   *   Genome    → present (GenBank Phase 5.1)
   *   Genes     → estimated count from NCBI annotation (future NCBI Gene module)
   *   mRNA      → flagged as available (future Gene Explorer, Phase 5.2+)
   *   Proteins  → flagged as available (future UniProt integration)
   *   Raw Reads → flagged if SRA data exists (future SRA integration)
   *
   * Future phases use this as the entry point to progressively expand deeper resources.
   */
  availableResources: AvailableResource[];

  /**
   * Resolution path taken for this resource.
   * Informational — for debugging and the Step 10 validation report.
   * "rule1" | "rule2" | "rule3"
   */
  resolutionRule?: "rule1" | "rule2" | "rule3";
}
