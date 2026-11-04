/**
 * types/protein-structure.ts — Phase 5.8A
 *
 * Two interfaces added by Phase 5.8A (Protein Structure Visualization):
 *
 * ProteinStructure
 *   A single normalized 3D structure record from one of two independent
 *   upstream sources:
 *     - AlphaFold DB (sourceType "predicted", sourceDatabase "alphafold")
 *     - RCSB PDB (sourceType "experimental", sourceDatabase "pdb")
 *
 *   Canonical identifier chain (byte-for-byte, exactly as every prior phase):
 *     proteinAccession — RefSeq (NP_/XP_) — the project-wide canonical identifier.
 *     uniprotAccession — resolved UniProt accession, traceability only, never a key.
 *
 * StructureResolutionResult
 *   The full resolution result for POST /api/protein/structure, carrying the
 *   independent per-source failure model (Section 6). Every distinction here
 *   MUST be preserved — never collapsed.
 */

/** Per-source status, exactly per Section 6. */
export type StructureSourceStatus =
  | "not-attempted"
  | "success"
  | "empty"
  | "error";

/** Top-level availability enum, exactly per Section 6. */
export type StructureAvailability =
  | "available"
  | "none"
  | "partial-source-failure"
  | "source-failure";

/**
 * A single normalized structure record.
 *
 * Security: `fileUrl` MUST always be a backend-constructed/validated HTTPS URL
 * against an allowlist of known static file hosts. It is NEVER a passthrough of
 * an upstream-provided URL string.
 */
export interface ProteinStructure {
  /** Canonical source-level structure identifier.
   *  PDB: the entry id (e.g. "1TUP") — does NOT by itself identify the
   *       entity/chain; entityId/instanceId carry that.
   *  AlphaFold: the model entity id (e.g. "AF-P04637-F1"). */
  sourceId: string;
  sourceType: "experimental" | "predicted";
  sourceDatabase: "pdb" | "alphafold";
  /** PDB polymer entity identifier; null for AlphaFold (not applicable). */
  entityId: string | null;
  /** PDB polymer instance/chain identifier; null when not applicable or AlphaFold. */
  instanceId: string | null;
  /** e.g. "X-RAY DIFFRACTION", "CRYO-EM"; null for predicted structures. */
  method: string | null;
  /** Resolution in Angstroms; null if not applicable. */
  resolution: number | null;
  /** AlphaFold pLDDT summary; null for experimental structures. */
  confidenceScore: number | null;
  /** Canonical protein residue range start (only when authoritative mapping permits). */
  coverageStart: number | null;
  /** Canonical protein residue range end (only when authoritative mapping permits). */
  coverageEnd: number | null;
  /** Fraction of canonical protein covered, from authoritative mapping; null when unavailable. */
  coverageFraction: number | null;
  /** Backend-constructed/validated HTTPS URL (see security rule above). */
  fileUrl: string;
  /** RefSeq accession — the project's canonical protein identifier. */
  proteinAccession: string;
  /** Resolved UniProt accession — traceability only, never the internal key. */
  uniprotAccession: string;
  /** NCBI Gene ID — traceability from parent GeneRecord. */
  geneId: string;
  /** Organism scientific name — traceability from parent record. */
  organism: string;
}

/** Per-source statuses, exactly per Section 6. */
export interface StructureSourceStatuses {
  alphafold: StructureSourceStatus;
  pdb: StructureSourceStatus;
}

/** Full resolution result for POST /api/protein/structure. */
export interface StructureResolutionResult {
  identifierStatus: "resolved" | "unresolved";
  structureAvailability: StructureAvailability;
  sourceStatuses: StructureSourceStatuses;
  structures: ProteinStructure[];
}