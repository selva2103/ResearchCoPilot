/**
 * types/pathway-membership.ts — PathwayMembership data contract (Phase 5.6B)
 *
 * Represents a gene's membership in a biological pathway from an external
 * curated database (Reactome and/or WikiPathways).
 *
 * DATA CONTRACT STABILITY:
 *   This interface is frozen alongside FunctionalAnnotation (5.6A).
 *   Do not rename or reshape exported fields.
 *
 * IDENTIFIER RULE:
 *   pathwayId is the canonical identifier. pathwayName is display-only.
 *   Never use pathwayName as a key, deduplication criterion, or equivalence check.
 *   Never merge pathways from different sources based on name similarity —
 *   only entries with literally identical pathwayId values are the same entry
 *   (which cannot occur across different databases).
 *
 * SOURCE COVERAGE (Phase 5.6B):
 *   - "reactome" — implemented; uses Reactome Analysis Service (gene symbol input)
 *   - "wikipathways" — preserved in type union per spec; NO working API found during
 *     Phase 5.6B audit (all WikiPathways endpoints returned 404/406). Type is future-ready.
 *
 * FIELD PROVENANCE (from Reactome Analysis Service POST /AnalysisService/identifiers/):
 *   pathwayId    ← response[n].stId           (stable Reactome ID, e.g. "R-HSA-6804754")
 *   pathwayName  ← response[n].name           (display label, e.g. "Regulation of TP53 Expression")
 *   source       ← "reactome"                 (hard-coded per audit decision)
 *   sourceUrl    ← constructed from stId      ("https://reactome.org/PathwayBrowser/#/{stId}")
 *   organism     ← response[n].species.name   (e.g. "Homo sapiens", "Mus musculus")
 *   geneId       ← from caller (GeneRecord.geneId) — NOT derived here
 *   geneSymbol   ← from caller (GeneRecord.officialSymbol) — NOT derived here
 *   inDisease    ← response[n].inDisease      (optional; for future filtering/display)
 */

export interface PathwayMembership {
  /** Canonical pathway identifier — NEVER use pathwayName as a key. */
  pathwayId: string;
  /** Display label only — never used as identifier or deduplication key. */
  pathwayName: string;
  /** Source database.
   *  - "reactome": implemented in Phase 5.6B.
   *  - "wikipathways": type future-ready; no working API found in Phase 5.6B audit. */
  source: "reactome" | "wikipathways";
  /** Direct link to the pathway entry in the source database. */
  sourceUrl: string;
  /** Organism scientific name (from source response, e.g. "Homo sapiens"). */
  organism: string;
  /** NCBI Gene ID — passed from already-resolved GeneRecord; NEVER re-derived here. */
  geneId: string;
  /** Gene symbol — passed from already-resolved GeneRecord; NEVER re-derived here. */
  geneSymbol: string;
  /** Whether this is a disease-associated pathway (Reactome inDisease flag). Optional. */
  inDisease?: boolean;
}
