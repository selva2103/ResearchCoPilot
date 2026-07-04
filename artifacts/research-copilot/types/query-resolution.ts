/**
 * types/query-resolution.ts — Biological Query Resolution Layer
 *
 * Phase 5.1.5 introduces a single structured QueryResolution type that every
 * scientific provider consumes instead of implementing its own query classification.
 *
 * Architecture contract (Step 16):
 * This type is the permanent entry point for all current and future scientific
 * providers: Gene Explorer (5.2), Transcript Explorer (5.3), Protein Explorer (5.4),
 * ENA, SRA, UniProt, AlphaFold, KEGG, Reactome.
 * No future provider should implement its own query classification.
 */

// ─── Core enumerations ────────────────────────────────────────────────────────

/**
 * Every biological entity type the resolver can classify into.
 * The resolver always outputs exactly one primary type (never a union or "maybe").
 *
 * Detection rules (Step 2 — concrete, deterministic):
 *   Accession   — matches NCBI RefSeq/GenBank/SRA prefix patterns (see lib/resolver/accession.ts)
 *   Assembly    — accession prefix is GCF_ or GCA_ (subset of Accession pattern)
 *   Chromosome  — accession prefix is NC_, NT_, NW_, or NZ_
 *   Genome      — accession prefix is NG_ (RefSeqGene region)
 *   Transcript  — accession prefix is NM_, NR_, XM_, or XR_
 *   Protein     — accession prefix is NP_, XP_, YP_, WP_, or AP_
 *   Gene        — matches GENE_SYMBOL_RE (/^[A-Z][A-Z0-9]{1,12}$/) AND confirmed
 *                 by NCBI Gene ESearch returning an exact symbol match
 *   Organism    — confirmed by NCBI Taxonomy ESearch (exact or best-ranked match)
 *   Disease     — confirmed by MedGen ESearch (NCBI medical concepts database)
 *   Taxonomy    — numeric TaxID string (e.g. "9606")
 *   Plasmid     — accession prefix is CP_ or NZ_ with annotated "plasmid" type
 *   Contig      — accession prefix is INSDC 4-letter WGS pattern
 *   Unknown     — no rule matched with confidence ≥ 0.60
 */
export type QueryType =
  | "Disease"
  | "Gene"
  | "Genome"
  | "Assembly"
  | "Organism"
  | "Taxonomy"
  | "Protein"
  | "Transcript"
  | "Accession"
  | "Chromosome"
  | "Plasmid"
  | "Contig"
  | "Unknown";

/**
 * Confidence tier — governs downstream gating behavior (Step 5).
 *
 * HIGH   (confidence ≥ 0.90):
 *   resolvedQuery (= normalizedQuery) is automatically passed to PubMed, GEO,
 *   and Sequence Foundation in place of the original free-text query.
 *   No user confirmation needed.
 *
 * MEDIUM (0.60 ≤ confidence < 0.90):
 *   The resolved interpretation is shown to the user as a suggestion.
 *   Downstream modules continue to receive originalQuery by default.
 *   The user must explicitly accept the suggestion to have it applied.
 *
 * LOW    (confidence < 0.60):
 *   Classified as Unknown. No suggestion is shown.
 *   Downstream modules receive originalQuery unchanged.
 */
export type ConfidenceTier = "high" | "medium" | "low";

// ─── Relationships ────────────────────────────────────────────────────────────

/**
 * Structured biological relationship map.
 *
 * Phase 5.1.5 populates: genes, organisms.
 * Future phases enrich the remaining fields without architectural changes:
 *   proteins   → Phase 5.4 (UniProt integration)
 *   pathways   → Phase 5.5 (KEGG / Reactome)
 *   variants   → Phase 5.6 (ClinVar)
 *   datasets   → Phase 5.7 (GEO integration)
 *   publications → Phase 5.8 (PubMed integration)
 */
export interface QueryRelationships {
  /** Gene symbols associated with the resolved entity (e.g. disease-associated genes). */
  genes?: string[];
  /** Protein names / UniProt IDs (Phase 5.4+). */
  proteins?: string[];
  /**
   * Scientific names of related organisms.
   * Example: Disease "Tuberculosis" → organisms ["Mycobacterium tuberculosis"].
   * Note: adding organisms here does NOT change queryType (type-independence rule, Step 10).
   */
  organisms?: string[];
  /** KEGG / Reactome pathway names (Phase 5.5+). */
  pathways?: string[];
  /** ClinVar variant identifiers (Phase 5.6+). */
  variants?: string[];
  /** GEO dataset accessions (Phase 5.7+). */
  datasets?: string[];
  /** PubMed PMIDs (Phase 5.8+). */
  publications?: string[];
}

// ─── Ambiguity (Step 10.5) ────────────────────────────────────────────────────

/**
 * One biologically valid candidate when multiple entities match the query
 * with similar confidence (e.g. ACTB in Homo sapiens vs Mus musculus vs other organisms).
 *
 * The resolver MUST NOT silently choose one when ambiguity cannot be resolved confidently.
 * Instead it returns all candidates and sets ambiguityDetected = true.
 */
export interface CandidateMatch {
  /** Primary database identifier (gene_id, TaxID, CUI, accession string). */
  identifier: string;
  /** Human-readable display name (official gene symbol, taxon name, disease title). */
  displayName: string;
  /** Organism the entity belongs to, when applicable. */
  organism?: string;
  /** The biological type of this specific candidate. */
  queryType: QueryType;
  /** Per-candidate confidence score (0–1). */
  confidence: number;
}

// ─── Main resolution interface ────────────────────────────────────────────────

/**
 * QueryResolution — the single structured output of the Biological Query Resolution Layer.
 *
 * Produced once per query by resolveQuery() in lib/resolver/index.ts.
 * Consumed by every downstream scientific provider (PubMed, GEO, Sequence Foundation,
 * and all future modules).
 */
export interface QueryResolution {
  // ── Input ─────────────────────────────────────────────────────────────────
  /** The raw query string exactly as entered by the user. Never modified. */
  originalQuery: string;

  /**
   * The canonical normalized form of the query.
   *
   * - HIGH tier: this string is passed to downstream modules instead of originalQuery.
   * - MEDIUM tier: offered to the user as a suggestion; not auto-applied.
   * - LOW tier: same as originalQuery; unused.
   *
   * Examples:
   *   "TB"              → "Tuberculosis"
   *   "TP53"            → "TP53"  (already canonical)
   *   "SARS-CoV-2"      → "Severe acute respiratory syndrome coronavirus 2"
   *   "NC_045512"       → "NC_045512"
   */
  normalizedQuery: string;

  // ── Classification ────────────────────────────────────────────────────────
  /**
   * Primary biological entity type.
   * Always exactly one value from QueryType — never a union or undefined.
   *
   * Type-independence rule (Step 10): synonym normalization may add related
   * organisms/genes but MUST NOT change queryType.
   * Example: "Tuberculosis" → queryType = "Disease" even though the related
   * organism is Mycobacterium tuberculosis.
   */
  queryType: QueryType;

  /** Overall confidence in the resolution (0–1). */
  confidence: number;

  /**
   * Confidence tier derived from the confidence score.
   * This — not confidence alone — governs which query string downstream modules receive.
   */
  confidenceTier: ConfidenceTier;

  // ── Provider ──────────────────────────────────────────────────────────────
  /**
   * Database or detection method that produced this resolution.
   * Values: "ncbi-gene", "ncbi-taxonomy", "medgen", "mesh",
   *         "ncbi-refseq", "ncbi-genbank", "ncbi-sra",
   *         "ebi-sra", "ddbj-sra", "accession-pattern", "hardcoded-synonym".
   */
  matchedProvider?: string;

  // ── Identifier ────────────────────────────────────────────────────────────
  /**
   * Primary database identifier.
   * Examples: "7157" (gene_id), "9606" (TaxID), "C0023418" (CUI), "NC_045512.2" (accession).
   */
  primaryIdentifier?: string;

  /**
   * Namespace of primaryIdentifier.
   * Values: "ncbi-gene", "ncbi-taxonomy", "medgen-cui", "mesh-id",
   *         "ncbi-refseq", "ncbi-genbank", "ncbi-sra", "ebi-sra", "ddbj-sra".
   */
  identifierScheme?: string;

  // ── Biological metadata ───────────────────────────────────────────────────
  /**
   * Official scientific name.
   * Examples: "Homo sapiens", "Severe acute respiratory syndrome coronavirus 2",
   *           "tumor protein p53".
   */
  scientificName?: string;

  /** Common or preferred organism name (may differ from scientificName). */
  organism?: string;

  /** NCBI Taxonomy ID as string. Example: "9606" for Homo sapiens. */
  taxonomyId?: string;

  // ── Relationships ─────────────────────────────────────────────────────────
  /** Structured biological relationships. Phase 5.1.5 populates genes and organisms only. */
  relationships: QueryRelationships;

  // ── Synonyms (Step 10) ────────────────────────────────────────────────────
  /** Alternative names and synonyms for the resolved entity. */
  synonyms?: string[];

  /**
   * Source of synonym data.
   * - "mesh"       : MeSH entry terms (canonical, preferred)
   * - "medgen"     : MedGen synonyms
   * - "ncbi-taxonomy" : NCBI Taxonomy other names / synonyms
   * - "hardcoded"  : fallback synonym table in lib/resolver/synonyms.ts
   *                  ⚠ KNOWN LIMITATION: hardcoded synonyms require manual maintenance.
   *                  See lib/resolver/synonyms.ts HARDCODED_SYNONYMS for the full list.
   */
  synonymSource?: string;

  // ── Ambiguity (Step 10.5) ─────────────────────────────────────────────────
  /** True when multiple biologically valid candidates exist with similar confidence. */
  ambiguityDetected?: boolean;

  /** All candidates when ambiguity is detected. */
  candidateMatches?: CandidateMatch[];

  /**
   * The candidate the resolver selected when one could be chosen confidently.
   * Undefined when the resolver defers to the user (ambiguity unresolved).
   */
  selectedMatch?: CandidateMatch;

  // ── Resolution metadata ───────────────────────────────────────────────────
  /**
   * Which Step 2 detection rule matched.
   * Examples:
   *   "accession-pattern:NC_"
   *   "accession-pattern:GCF_"
   *   "ncbi-gene-exact-human"
   *   "ncbi-gene-exact-nonhuman"
   *   "ncbi-gene-ambiguous"
   *   "ncbi-taxonomy-exact"
   *   "ncbi-taxonomy-partial"
   *   "medgen-exact"
   *   "medgen-partial"
   *   "hardcoded-synonym"
   *   "unknown-fallback"
   */
  resolutionPath?: string;

  /**
   * Human-readable notes.
   * Used to flag known limitations, e.g. hardcoded synonym fallback.
   */
  notes?: string;

  // ── Organism-prefix context (FIX 5 — Organism-Aware Gene Ranking Patch) ───
  /**
   * NCBI Taxonomy ID of the organism detected from a species-qualified prefix
   * in the original query (e.g. "mouse CD4" → 10090).
   *
   * Set only when an organism prefix was detected and a matching gene was found.
   * null for all other query types.
   *
   * Downstream modules (Gene Explorer, Transcript Explorer, Protein Explorer)
   * must use this field — not re-parse the original query — to obtain organism
   * context (FIX 6 architecture contract).
   */
  detectedOrganismTaxId?: number | null;

  /**
   * NCBI scientific name of the organism detected from the prefix
   * (e.g. "Mus musculus"). Paired with detectedOrganismTaxId.
   */
  detectedOrganismName?: string | null;

  /**
   * The gene symbol / query remainder after stripping the organism prefix.
   * Example: "mouse CD4" → "CD4"; "rat EGFR" → "EGFR".
   * null when no organism prefix was detected.
   */
  strippedGeneQuery?: string | null;
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Derive ConfidenceTier from a numeric confidence score. */
export function toConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.90) return "high";
  if (confidence >= 0.60) return "medium";
  return "low";
}

/** Build the Unknown fallback resolution. */
export function unknownResolution(originalQuery: string): QueryResolution {
  return {
    originalQuery,
    normalizedQuery: originalQuery,
    queryType: "Unknown",
    confidence: 0.30,
    confidenceTier: "low",
    relationships: {},
    resolutionPath: "unknown-fallback",
    notes: "No confident biological interpretation found for this query.",
  };
}
