/**
 * types/protein-interaction.ts - Phase 5.9A
 *
 * Normalized protein-protein association records from STRING. Edges are functional
 * associations (not necessarily physical binding). partnerUniprot is always null:
 * STRING does not return a partner UniProt accession and we never invent identifiers.
 */

export type InteractionSourceStatus = "not-attempted" | "success" | "empty" | "error";
export type InteractionAvailability = "available" | "none" | "source-failure";

/** Per-channel evidence scores as returned by STRING (0-1). null when absent. */
export interface InteractionChannelScores {
  neighborhood: number | null; // nscore
  fusion: number | null; // fscore
  cooccurrence: number | null; // pscore
  coexpression: number | null; // ascore
  experiments: number | null; // escore
  databases: number | null; // dscore
  textmining: number | null; // tscore
}

export interface ProteinInteractionPartner {
  partnerName: string;
  partnerStringId: string;
  ncbiTaxonId: number;
  /** STRING combined score, 0-1. */
  combinedScore: number;
  channelScores: InteractionChannelScores;
  partnerUniprot: null;
}

export interface InteractionQueryProtein {
  stringId: string;
  preferredName: string | null;
  ncbiTaxonId: number;
}

export interface InteractionResolutionResult {
  /** RefSeq -> UniProt resolution (existing resolver). */
  identifierStatus: "resolved" | "unresolved";
  /** UniProt -> STRING mapping, accepted only when the taxon matches the request. */
  stringMappingStatus: "resolved" | "unresolved" | "not-attempted";
  availability: InteractionAvailability;
  sourceStatus: InteractionSourceStatus;
  queryProtein: InteractionQueryProtein | null;
  stringVersion: string | null;
  /** Requested minimum combined score, 0-1000 (STRING scale). */
  minScore: number;
  limit: number;
  partners: ProteinInteractionPartner[];
}
