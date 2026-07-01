/**
 * types/gene-record.ts — Gene Explorer data model (Phase 5.2)
 *
 * GeneRecord is the structured output of the Gene Explorer module (lib/gene/).
 * It is consumed by the frontend GeneExplorerSection component and returned from
 * /api/analyze as part of the AnalyzeResponse.
 *
 * Field provenance (confirmed by pre-code live API inspection — 2026-07-01):
 *
 *   Path A — NCBI Gene ESummary (db=gene, retmode=json):
 *     geneId, officialSymbol, fullName, organism, taxonomyId,
 *     chromosome, cytogeneticLocation, genomicStart, genomicEnd, strand,
 *     summary, aliases, omimId (from mim[] array).
 *
 *   Path B — NCBI ELink llinks (dbfrom=gene, cmd=llinks, retmode=json):
 *     ensemblId (extracted from Bgee URL via regex /(ENS[A-Z]*G\d+)/),
 *     hgncId (NOT available via ESummary or ELink; null in Phase 5.2 — see below).
 *
 * Known limitations documented from pre-code inspection:
 *   - geneType: the ESummary `genetype` field returns null/None for ALL genes
 *     tested (TP53, BRCA2, EGFR, PTEN, mouse Trp53). Gene type would require
 *     EFetch XML parsing (Gene-ref_type field). Deferred to Phase 5.3.
 *   - hgncId: HGNC IDs are not exposed via ESummary or ELink llinks in a
 *     reliable, parseable format. Requires EFetch XML Dbtag parsing.
 *     Always null in Phase 5.2.
 *   - geneRifCount: not retrievable from ESummary without a separate
 *     elink gene→pubmed call. Always null in Phase 5.2.
 *   - omimId: present in ESummary `mim[]` for human genes with OMIM entries;
 *     empty array (→ null) for non-human genes (confirmed: mouse Trp53, mim=[]).
 *   - ensemblId: extracted from Bgee ELink URL. Not available for all genes —
 *     null when Bgee has no entry (e.g. some non-model-organism genes).
 *
 * Phase 5.3 expansion: GeneRecord.transcripts will expand from an availability
 * flag into actual TranscriptRecord objects. The core GeneRecord fields MUST NOT
 * change between phases — only new fields may be added.
 *
 * Phase 5.4 expansion: GeneRecord.proteins will similarly expand into
 * ProteinRecord objects.
 */

// ─── GeneRecord ───────────────────────────────────────────────────────────────

export interface GeneRecord {
  // ── Core fields (Path A — NCBI Gene ESummary) ─────────────────────────────

  /** NCBI Gene ID (numeric string). Example: "7157" for TP53. */
  geneId: string;

  /** Official gene symbol. Example: "TP53". */
  officialSymbol: string;

  /** Full gene name. Example: "tumor protein p53". */
  fullName: string;

  /** Scientific name of the organism. Example: "Homo sapiens". */
  organism: string;

  /** NCBI Taxonomy ID. Example: "9606" for Homo sapiens. */
  taxonomyId: string;

  /**
   * Chromosome number or label. Example: "17" for TP53, "X" for CFTR.
   * null when not annotated (e.g. some non-model organisms).
   */
  chromosome: string | null;

  /**
   * Cytogenetic band location. Example: "17p13.1" for TP53.
   * Available for human/mouse/rat; format may differ for non-human organisms
   * (e.g. "11 42.83 cM" for mouse Trp53). null when absent.
   */
  cytogeneticLocation: string | null;

  /**
   * Genomic start coordinate (0-based, GRCh38/current assembly).
   * Derived from ESummary genomicinfo[0].chrstart/chrstop — the LOWER value
   * regardless of strand, consistent with standard coordinate conventions.
   * null when genomicinfo is absent.
   */
  genomicStart: number | null;

  /**
   * Genomic end coordinate (0-based, GRCh38/current assembly).
   * The HIGHER of chrstart/chrstop. null when genomicinfo is absent.
   */
  genomicEnd: number | null;

  /**
   * Strand orientation. "+" = plus strand, "-" = minus strand.
   * Derived from ESummary genomicinfo[0]: chrstart > chrstop → "-".
   * null when genomicinfo is absent.
   */
  strand: "+" | "-" | null;

  /**
   * Gene type (e.g. "protein-coding", "ncRNA", "pseudogene", "tRNA", "rRNA").
   * NOT available from ESummary (genetype field always null in ESummary v0.3
   * for all genes tested). Requires EFetch XML Gene-ref_type field parsing.
   * Always null in Phase 5.2. Phase 5.3 may populate via EFetch XML.
   */
  geneType: string | null;

  /**
   * NCBI Gene curated summary text.
   * null when NCBI Gene has no curated summary (common for non-model organisms).
   * The UI must render "No curated summary available for this gene." when null —
   * the card must NOT collapse or hide the summary section on null.
   */
  summary: string | null;

  /**
   * Alternative gene names / aliases.
   * Derived from ESummary otheraliases (comma-separated string).
   * Empty array when no aliases are listed.
   */
  aliases: string[];

  /** Always "ncbi-gene". Documents the authoritative source for this record. */
  sourceDatabase: "ncbi-gene";

  // ── Cross-database identifiers (Path B — ELink llinks) ────────────────────

  /**
   * HGNC ID (human-specific). Format: "HGNC:11998" for TP53.
   * NOT available from ESummary or ELink llinks in a reliable parseable format.
   * Requires EFetch XML Dbtag parsing. Always null in Phase 5.2.
   */
  hgncId: string | null;

  /**
   * Ensembl Gene ID (e.g. "ENSG00000141510" for human TP53).
   * Extracted from ELink llinks Bgee URL (regex: /(ENS[A-Z]*G\d+)/).
   * Covers human (ENSG), mouse (ENSMUSG), and other model organisms.
   * null when Bgee has no entry for this gene or ELink fails.
   */
  ensemblId: string | null;

  /**
   * OMIM MIM number (e.g. "191170" for TP53).
   * Available from ESummary mim[] array for human genes with OMIM entries.
   * null for non-human genes (mouse Trp53 mim=[]) or genes without OMIM entries.
   */
  omimId: string | null;

  /**
   * Number of GeneRIF entries for this gene.
   * NOT retrievable from ESummary without an additional elink gene→pubmed call.
   * Always null in Phase 5.2.
   */
  geneRifCount: number | null;

  // ── Links ─────────────────────────────────────────────────────────────────

  /**
   * NCBI Gene page URL.
   * Pattern: https://www.ncbi.nlm.nih.gov/gene/{geneId}
   */
  ncbiGeneUrl: string;

  /**
   * Ensembl Gene page URL.
   * Pattern: https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={ensemblId}
   * (Human-specific pattern; non-human Ensembl URLs differ by organism — only
   * human Ensembl URLs are constructed; others are null even if ensemblId is set.)
   * null when ensemblId is null.
   */
  ensemblUrl: string | null;

  /**
   * OMIM entry URL.
   * Pattern: https://www.omim.org/entry/{omimId}
   * null when omimId is null.
   */
  omimUrl: string | null;

  // ── Expandable resources (availability flags only — Phase 5.2) ─────────────
  // These are stubs. Phases 5.3 and 5.4 expand transcripts and proteins
  // from flags into full TranscriptRecord/ProteinRecord arrays.
  // The interface shape (available + estimatedCount) MUST NOT change in future
  // phases — only the data inside may be enriched.

  /**
   * Transcript availability flag.
   * estimatedCount: derived from ESummary genomicinfo[0].exoncount (a lower bound —
   * actual transcript count requires separate EFetch/RefSeq call).
   * Phase 5.3 expands this into full TranscriptRecord objects.
   */
  transcripts: {
    available: boolean;
    estimatedCount: number | null;
  };

  /**
   * Protein availability flag.
   * true when gene is protein-coding (heuristic: exoncount > 0 and has summary).
   * Phase 5.4 expands this into full ProteinRecord objects.
   */
  proteins: {
    available: boolean;
    estimatedCount: number | null;
  };

  /** Variant annotation availability flag. Phase 5.5+. Not clickable in Phase 5.2. */
  variants: { available: boolean };

  /** Gene expression availability flag. Phase 5.6+. Not clickable in Phase 5.2. */
  expression: { available: boolean };

  /** Pathway membership availability flag. Phase 5.7+. Not clickable in Phase 5.2. */
  pathways: { available: boolean };

  // ── Resolution metadata ────────────────────────────────────────────────────

  /**
   * Which resolution path was taken.
   * "direct-efetch": used resolver's Gene ID directly (skipped ESearch)
   * "esearch-symbol": ESearch by gene symbol
   * "esearch-query": ESearch by free-text query
   */
  resolutionPath: "direct-efetch" | "esearch-symbol" | "esearch-query";

  /**
   * Whether this record was enriched via Path B (ELink).
   * false when Path B failed or was skipped (multi-gene lazy mode).
   * "partial" when Path B ran but some cross-database IDs could not be retrieved.
   * "full" when Path B ran successfully.
   */
  linkEnrichment: "none" | "partial" | "full";

  /**
   * Human-readable note about enrichment failures or known limitations.
   * Only present when linkEnrichment is "partial" or when a known limitation applies.
   */
  enrichmentNote?: string;
}
