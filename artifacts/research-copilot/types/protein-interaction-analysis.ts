/**
 * types/protein-interaction-analysis.ts - STRING network analysis (stats + GO enrichment)
 */

export interface InteractionNetworkStats {
  numberOfNodes: number;
  numberOfEdges: number;
  averageNodeDegree: number;
  localClusteringCoefficient: number;
  expectedNumberOfEdges: number;
  pValue: number;
}

export interface InteractionEnrichmentTerm {
  term: string;
  description: string;
  genesInNetwork: number;
  genesInBackground: number;
  fdr: number;
  strength: number | null;
  signal: number | null;
}

export interface InteractionAnalysisResult {
  sourceStatus: "success" | "partial" | "error";
  statsStatus: "success" | "error";
  enrichmentStatus: "success" | "empty" | "error";
  stringVersion: string | null;
  proteinCount: number;
  minScore: number;
  stats: InteractionNetworkStats | null;
  goProcess: InteractionEnrichmentTerm[];
}
