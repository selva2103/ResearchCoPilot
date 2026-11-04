/**
 * types/drug-structure.ts - Phase 5.10C
 *
 * PubChem record lookup for one small-molecule drug:
 * ChEMBL structure -> InChIKey -> PubChem CID -> computed 3D SDF.
 */

export type PubChemAvailability =
  | "available"
  | "no-structure"
  | "ambiguous"
  | "no-3d"
  | "source-failure";

export interface PubChemResult {
  chemblId: string;
  availability: PubChemAvailability;
  /** PubChem CID (digits only). Set for "available" and "no-3d". */
  cid: string | null;
  /** Number of CIDs PubChem returned for the structure's InChIKey. */
  cidCount: number;
}
