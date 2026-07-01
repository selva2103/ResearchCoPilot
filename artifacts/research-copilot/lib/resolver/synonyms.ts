/**
 * lib/resolver/synonyms.ts — Query Synonym Normalization (Step 10)
 *
 * Preferred synonym sources (Step 4 / Step 10):
 *   1. MeSH entry terms  — canonical for medical/disease terms
 *   2. MedGen synonyms   — covered within the disease resolver itself
 *   3. NCBI Taxonomy synonyms — covered within the organism resolver itself
 *   4. Hardcoded fallback — used ONLY when the above sources do not cover the term
 *
 * ⚠ KNOWN LIMITATION (flagged per Step 10):
 *   The hardcoded HARDCODED_SYNONYMS table below is a fallback for abbreviations
 *   and common aliases that MeSH/MedGen/Taxonomy APIs do not readily surface via
 *   a single ESearch term lookup. This table requires periodic manual maintenance
 *   as new abbreviations enter common usage. Any entry here should be re-evaluated
 *   when MeSH / MedGen / NCBI Taxonomy adds official coverage for that term.
 *
 * Type-independence rule (Step 10):
 *   Synonym normalization changes normalizedQuery and may populate
 *   relationships.organisms / relationships.genes, but MUST NOT change queryType.
 *   E.g. "TB" resolves type="Disease", not "Organism", even after synonymExpansion
 *   reveals Mycobacterium tuberculosis as the causative organism.
 *
 * synonymPreferredType (Bug fix — Phase 5.1.5 validation):
 *   Some disease abbreviations (e.g. "COVID" → "COVID-19") expand to terms that
 *   NCBI Taxonomy will match as a virus organism BEFORE MedGen sees them, violating
 *   the type-independence rule. SYNONYM_TYPE_HINTS maps these keys to their intended
 *   QueryType so the resolver pipeline can skip the Organism step for disease synonyms.
 *   This is a routing hint only — it does NOT force the final queryType; if the
 *   disease step also returns null, the resolver falls through to Unknown normally.
 */

// ─── Hardcoded synonym fallback table ─────────────────────────────────────────
// Keys must be uppercase for case-insensitive lookup.
// Values are the canonical expanded forms to use in downstream queries.
//
// ⚠ DOCUMENTED HARDCODED FALLBACK — requires maintenance.
//
// Coverage rationale: these abbreviations are universally recognized in biomedical
// literature but their resolution through a single MeSH/MedGen ESearch term lookup
// is unreliable (ESearch returns many results for "TB", "MS", etc.).

const HARDCODED_SYNONYMS: Readonly<Record<string, string>> = {
  // ── Infectious diseases ──────────────────────────────────────────────────
  TB:    "Tuberculosis",
  MTB:   "Tuberculosis",

  // ── Viral diseases ────────────────────────────────────────────────────────
  COVID:     "COVID-19",
  "COVID19": "COVID-19",
  FLU:       "Influenza",

  // ── Cancers / leukemias ───────────────────────────────────────────────────
  AML:  "Acute Myeloid Leukemia",
  CML:  "Chronic Myeloid Leukemia",
  ALL:  "Acute Lymphoblastic Leukemia",
  CLL:  "Chronic Lymphocytic Leukemia",
  NSCLC: "Non-Small Cell Lung Cancer",
  SCLC:  "Small Cell Lung Cancer",

  // ── Other diseases ────────────────────────────────────────────────────────
  CF:    "Cystic Fibrosis",
  COPD:  "Chronic Obstructive Pulmonary Disease",
  MS:    "Multiple Sclerosis",      // ⚠ ambiguous: also Mass Spectrometry in other contexts
  RA:    "Rheumatoid Arthritis",
  SLE:   "Systemic Lupus Erythematosus",
  T1D:   "Type 1 Diabetes",
  T2D:   "Type 2 Diabetes",
  AD:    "Alzheimer Disease",       // ⚠ ambiguous: also Atopic Dermatitis, Autosomal Dominant
  PD:    "Parkinson Disease",
  ALS:   "Amyotrophic Lateral Sclerosis",
  HD:    "Huntington Disease",
  MD:    "Muscular Dystrophy",      // NB: generic form — resolver should refine via MedGen
  DMD:   "Duchenne Muscular Dystrophy",
  DS:    "Down Syndrome",           // ⚠ ambiguous: also Danish / Dutch / other abbreviations

  // ── Organisms / common names ──────────────────────────────────────────────
  // NOTE: organism synonyms are also handled by NCBI Taxonomy "other names" field.
  // Only add here when NCBI Taxonomy ESearch does not surface the right taxon directly.
  "E. COLI": "Escherichia coli",
  ECOLI:     "Escherichia coli",
  YEAST:     "Saccharomyces cerevisiae",
  ZEBRAFISH: "Danio rerio",
  FRUITFLY:  "Drosophila melanogaster",
  NEMATODE:  "Caenorhabditis elegans",
  MOUSE:     "Mus musculus",
  RAT:       "Rattus norvegicus",
};

// ─── Synonym type hints ────────────────────────────────────────────────────────
// Maps HARDCODED_SYNONYMS keys to their intended biological type.
//
// Purpose (Bug fix — Phase 5.1.5 validation):
//   Some disease abbreviations expand to terms that NCBI Taxonomy will match as a
//   virus/organism BEFORE MedGen gets a chance to classify them as Disease.
//   Example: "COVID" → "COVID-19" → NCBI Taxonomy returns SARS-CoV-2 (Organism),
//   but the user's intent is the disease COVID-19. This violates the
//   type-independence rule which states synonym expansion must not change queryType.
//
//   SYNONYM_TYPE_HINTS tells the resolver pipeline to SKIP the Organism step for
//   keys that are known disease abbreviations. If the Disease step also fails,
//   the resolver falls through to Unknown as normal.
//
// Keys: same uppercase keys as HARDCODED_SYNONYMS.
// Values: "Disease" | "Organism" (only Disease/Organism hints are needed;
//         gene synonyms are not in HARDCODED_SYNONYMS).
//
// ⚠ REQUIRES MAINTENANCE alongside HARDCODED_SYNONYMS.

const SYNONYM_TYPE_HINTS: Readonly<Record<string, "Disease" | "Organism">> = {
  // Disease abbreviations
  TB:       "Disease",
  MTB:      "Disease",
  COVID:    "Disease",
  COVID19:  "Disease",
  FLU:      "Disease",
  AML:      "Disease",
  CML:      "Disease",
  ALL:      "Disease",
  CLL:      "Disease",
  NSCLC:    "Disease",
  SCLC:     "Disease",
  CF:       "Disease",
  COPD:     "Disease",
  MS:       "Disease",
  RA:       "Disease",
  SLE:      "Disease",
  T1D:      "Disease",
  T2D:      "Disease",
  AD:       "Disease",
  PD:       "Disease",
  ALS:      "Disease",
  HD:       "Disease",
  MD:       "Disease",
  DMD:      "Disease",
  DS:       "Disease",
  // Organism abbreviations
  "E. COLI": "Organism",
  ECOLI:     "Organism",
  YEAST:     "Organism",
  ZEBRAFISH: "Organism",
  FRUITFLY:  "Organism",
  NEMATODE:  "Organism",
  MOUSE:     "Organism",
  RAT:       "Organism",
};

// ─── Disease → causative organism associations (hardcoded, Phase 5.1.5) ────────
// Used to populate relationships.organisms for disease queries.
// Only covers diseases with a single well-defined causative organism.
// ⚠ KNOWN LIMITATION: must be updated manually as new associations are curated.
// Future phases should replace/augment this with live MedGen → NCBI Taxonomy elink.

export const DISEASE_ORGANISM_ASSOCIATIONS: Readonly<Record<string, string[]>> = {
  tuberculosis:      ["Mycobacterium tuberculosis"],
  "covid-19":        ["Severe acute respiratory syndrome coronavirus 2"],
  influenza:         ["Influenza A virus", "Influenza B virus"],
  malaria:           ["Plasmodium falciparum", "Plasmodium vivax"],
  "lyme disease":    ["Borrelia burgdorferi"],
  leprosy:           ["Mycobacterium leprae"],
  cholera:           ["Vibrio cholerae"],
  typhoid:           ["Salmonella enterica"],
  syphilis:          ["Treponema pallidum"],
  anthrax:           ["Bacillus anthracis"],
  brucellosis:       ["Brucella abortus"],
  plague:            ["Yersinia pestis"],
  "whooping cough":  ["Bordetella pertussis"],
  pertussis:         ["Bordetella pertussis"],
  "dengue fever":    ["Dengue virus"],
  "ebola":           ["Ebola virus"],
  "hepatitis b":     ["Hepatitis B virus"],
  "hepatitis c":     ["Hepatitis C virus"],
  hiv:               ["Human immunodeficiency virus 1"],
  aids:              ["Human immunodeficiency virus 1"],
  rabies:            ["Rabies lyssavirus"],
  toxoplasmosis:     ["Toxoplasma gondii"],
  leishmaniasis:     ["Leishmania donovani"],
  trypanosomiasis:   ["Trypanosoma brucei"],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SynonymResult {
  /** The normalized query to use in place of the original. Equals originalQuery if no synonym found. */
  normalizedQuery: string;
  /** Source of the synonym expansion, or undefined if none occurred. */
  synonymSource: string | undefined;
  /** Any alternate names known at this stage. */
  synonyms: string[];
  /** True if normalization actually changed the query string. */
  expanded: boolean;
  /**
   * Type hint derived from SYNONYM_TYPE_HINTS.
   * When expanded=true and synonymPreferredType="Disease", the resolver pipeline
   * skips the Organism step to prevent disease abbreviations (e.g. "COVID" → "COVID-19")
   * from being misclassified as Organism by NCBI Taxonomy.
   * Undefined when no hint is registered or expanded=false.
   */
  synonymPreferredType?: "Disease" | "Organism";
}

/**
 * Normalize a query via the hardcoded synonym table.
 *
 * This is the first step in the resolver pipeline. If a match is found,
 * the normalized term is passed to subsequent API-based resolvers.
 * If not found, the original query is returned unchanged.
 *
 * NOTE: MeSH / MedGen / NCBI Taxonomy API-based synonym lookups happen inside
 * the organism and disease resolvers themselves (they receive live synonym data
 * as part of the ESummary response). This function only handles the hardcoded fallback.
 */
export function normalizeSynonyms(query: string): SynonymResult {
  const key = query.trim().toUpperCase();
  const canonical = HARDCODED_SYNONYMS[key];

  if (canonical) {
    return {
      normalizedQuery: canonical,
      synonymSource: "hardcoded",
      synonyms: [canonical],
      expanded: true,
      synonymPreferredType: SYNONYM_TYPE_HINTS[key],
    };
  }

  return {
    normalizedQuery: query.trim(),
    synonymSource: undefined,
    synonyms: [],
    expanded: false,
  };
}

/**
 * Look up disease-associated organisms for a disease name.
 * Returns empty array if no known association exists.
 */
export function getAssociatedOrganisms(diseaseName: string): string[] {
  const key = diseaseName.toLowerCase().trim();
  return DISEASE_ORGANISM_ASSOCIATIONS[key] ?? [];
}
