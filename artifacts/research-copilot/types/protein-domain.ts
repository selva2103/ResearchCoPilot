/**
 * types/protein-domain.ts — Phase 5.7A
 *
 * Two interfaces added by Phase 5.7A (Protein Domains Foundation):
 *
 * ProteinIdentifierMapping
 *   Result of resolving a RefSeq protein accession (NP_/XP_) to a UniProt
 *   accession via the official UniProt ID Mapping API (RefSeq_Protein →
 *   UniProtKB). Used as input to ProteinDomainService (InterPro queries).
 *
 *   Resolution rules (Step 1 decision, Phase 5.7A):
 *     resolved   — exactly one Swiss-Prot (reviewed) entry found; uniprotAccession
 *                  is set; reviewed = true.
 *     unresolved — zero reviewed entries found among mappings, or zero mappings
 *                  total; uniprotAccession = null; reviewed = null.
 *     ambiguous  — two or more reviewed entries found; uniprotAccession = null;
 *                  reviewed = null. Never silently pick "the first result."
 *
 * ProteinDomain
 *   A single domain annotation from InterPro, covering one member database entry
 *   (Pfam, PROSITE, PANTHER, PRINTS, CATH, SSF, CDD, etc.) with its canonical
 *   accession, display name, and residue-position boundaries.
 *
 *   Canonical identifier: domainId (e.g. "PF00870", "IPR002117", "cd08367").
 *   Display text only:    domainName — never used as a key.
 *   Internal key:         proteinAccession (RefSeq, never UniProt) — consistent
 *                         with every other type in this project.
 */

/** Result of resolving a RefSeq protein accession to a UniProt accession. */
export interface ProteinIdentifierMapping {
  /** The RefSeq accession that was queried (e.g. "NP_000537.3"). */
  refseqAccession: string;
  /** The resolved UniProt accession, or null if unresolved/ambiguous. */
  uniprotAccession: string | null;
  /** Whether the resolved entry is Swiss-Prot reviewed; null if unresolved/ambiguous. */
  reviewed: boolean | null;
  /** Resolution outcome. */
  resolutionStatus: "resolved" | "unresolved" | "ambiguous";
  /** Always "uniprot-id-mapping" — future phases may add additional sources. */
  source: "uniprot-id-mapping";
}

/** A single protein domain annotation from InterPro. */
export interface ProteinDomain {
  /** Canonical accession — e.g. "PF00870", "IPR002117", "cd08367". Never fabricated. */
  domainId: string;
  /** Display label only — never used as a cache key or lookup identifier. */
  domainName: string;
  /** Data source for this domain annotation. */
  source: "genpept-features" | "interpro";
  /** Start residue position (1-based) on the protein, or null if unknown. */
  startPosition: number | null;
  /** End residue position (1-based) on the protein, or null if unknown. */
  endPosition: number | null;
  /** RefSeq accession — the project's canonical protein identifier. */
  proteinAccession: string;
  /** The resolved UniProt accession used for the InterPro lookup. */
  uniprotAccession: string;
  /** NCBI Gene ID — traceability from parent GeneRecord. */
  geneId: string;
  /** Organism scientific name — traceability from parent record. */
  organism: string;
}
