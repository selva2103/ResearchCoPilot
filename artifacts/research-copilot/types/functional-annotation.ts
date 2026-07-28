/**
 * types/functional-annotation.ts — FunctionalAnnotation data model (Phase 5.6A)
 *
 * Canonical identifier: goId (e.g. "GO:0006915") — NEVER the term name.
 * GO IDs are stable; term names are revised by the GO Consortium.
 *
 * source: "ncbi-gene-xml" — confirmed by Phase 5.6A audit (Gene EFetch XML
 *   coverage is comparably complete to QuickGO for all four audit genes).
 *
 * evidenceLabel: built from EVIDENCE_CODE_LABELS — normalized ONCE here at the
 *   data layer. Components display it but never re-implement the lookup.
 */

export interface FunctionalAnnotation {
  /** Canonical GO identifier, e.g. "GO:0006915". Never the term name. */
  goId: string;
  /** Human-readable GO term name, e.g. "apoptotic process". Display label only. */
  term: string;
  aspect: "biological_process" | "molecular_function" | "cellular_component";
  /** GO Consortium's own standard code, preserved as-is (e.g. "IEA", "TAS", "EXP"). */
  evidenceCode: string;
  /** Human-readable expansion of evidenceCode, e.g. "Inferred from Electronic Annotation". */
  evidenceLabel: string;
  /** Data source — always ncbi-gene-xml for Phase 5.6A (audit confirmed sufficient). */
  source: "ncbi-gene-xml" | "gene2go" | "quickgo";
  /** NCBI Gene ID — canonical identifier, never re-resolved in this phase. */
  geneId: string;
  /** Gene symbol — display label only, passed through from caller. */
  geneSymbol: string;
  /** Organism scientific name — display label only, passed through from caller. */
  organism: string;
}

// ─── Evidence code → label mapping ────────────────────────────────────────────
// Implemented ONCE here at the data layer. UI components consume evidenceLabel
// directly — they must NOT re-implement this lookup.
// Source: GO Consortium evidence code taxonomy (https://geneontology.org/docs/guide-go-evidence-codes/)

export const EVIDENCE_CODE_LABELS: Readonly<Record<string, string>> = {
  // ── Experimental evidence ──────────────────────────────────────────────────
  EXP: "Inferred from Experiment",
  IDA: "Inferred from Direct Assay",
  IPI: "Inferred from Physical Interaction",
  IMP: "Inferred from Mutant Phenotype",
  IGI: "Inferred from Genetic Interaction",
  IEP: "Inferred from Expression Pattern",
  // ── High-throughput experimental ──────────────────────────────────────────
  HTP: "Inferred from High Throughput Experiment",
  HDA: "Inferred from High Throughput Direct Assay",
  HMP: "Inferred from High Throughput Mutant Phenotype",
  HGI: "Inferred from High Throughput Genetic Interaction",
  HEP: "Inferred from High Throughput Expression Pattern",
  // ── Phylogenetically-inferred ─────────────────────────────────────────────
  IBA: "Inferred from Biological aspect of Ancestor",
  IBD: "Inferred from Biological aspect of Descendant",
  IKR: "Inferred from Key Residues",
  IRD: "Inferred from Rapid Divergence",
  // ── Computational analysis ────────────────────────────────────────────────
  ISS: "Inferred from Sequence or Structural Similarity",
  ISO: "Inferred from Sequence Orthology",
  ISA: "Inferred from Sequence Alignment",
  ISM: "Inferred from Sequence Model",
  IGC: "Inferred from Genomic Context",
  RCA: "Inferred from Reviewed Computational Analysis",
  // ── Author statement ──────────────────────────────────────────────────────
  TAS: "Traceable Author Statement",
  NAS: "Non-traceable Author Statement",
  // ── Curator ───────────────────────────────────────────────────────────────
  IC: "Inferred by Curator",
  ND: "No Biological Data available",
  // ── Electronic annotation (computational, no direct experimental support) ──
  IEA: "Inferred from Electronic Annotation",
};

/**
 * Resolve an evidence code to its human-readable label.
 * Falls back to the code itself if unknown — never throws.
 */
export function resolveEvidenceLabel(code: string): string {
  return EVIDENCE_CODE_LABELS[code.trim().toUpperCase()] ?? code;
}

/**
 * Returns true for evidence codes that are computationally derived (no direct experimental
 * support). Used by UI to visually distinguish computational from experimental annotations.
 *
 * IEA is the primary computational code from NCBI Gene XML. ISS, ISO, ISA, ISM, IGC, RCA,
 * IBA, IBD, IKR, IRD are also inferred rather than experimentally validated.
 */
export function isComputationalEvidence(code: string): boolean {
  const COMPUTATIONAL = new Set([
    "IEA", "ISS", "ISO", "ISA", "ISM", "IGC", "RCA",
    "IBA", "IBD", "IKR", "IRD",
  ]);
  return COMPUTATIONAL.has(code.trim().toUpperCase());
}
