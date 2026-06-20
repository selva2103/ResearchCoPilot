import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import { searchGeoDatasets } from "@/lib/geo";
import type { Paper } from "@/types/paper";
import type { Dataset } from "@/types/dataset";

// TODO: SRA integration         — NCBI SRA for raw sequencing runs linked to GSE accessions
// TODO: ArrayExpress integration — EBI ArrayExpress for European transcriptomics datasets
// TODO: TCGA integration        — NCI GDC portal for cancer genomics cohort data
// TODO: Europe PMC integration  — full-text search to supplement PubMed coverage
// TODO: AI reasoning layer      — use OpenAI GPT-4 to generate landscape, emergingAreas,
//                                  researchGaps, and projects from query + paper abstracts
// TODO: Keyword extraction      — cluster PubMed MeSH terms + GEO metadata for topics
// TODO: RAG support             — retrieve semantically similar papers + datasets
// TODO: Vector embeddings       — embed abstracts + dataset summaries for similarity search

interface AnalyzeRequest {
  query: string;
}

interface AnalyzeResponse {
  landscape: string[];
  emergingAreas: string[];
  researchGaps: string[];
  projects: string[];
  datasets: Dataset[];
  papers: Paper[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as AnalyzeRequest;

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { error: "query is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const query = body.query.trim();

  // PubMed and GEO run concurrently — neither depends on the other
  const [papers, datasets] = await Promise.all([
    searchPubMed(query),     // ESearch → ESummary + EFetch (parallel) → Paper[]
    searchGeoDatasets(query), // ESearch → ESummary → Dataset[]
  ]);

  // Mock data — will be replaced by OpenAI reasoning over papers + datasets
  const result: AnalyzeResponse = {
    landscape: [
      "Transcriptomics",
      "Biomarker Discovery",
      "Machine Learning",
    ],
    emergingAreas: [
      "Multi-omics integration",
      "AI-assisted biomarker prediction",
      "Single-cell transcriptomics",
    ],
    researchGaps: [
      "Limited South Asian cohorts",
      "Lack of longitudinal validation studies",
      "Insufficient multi-omics datasets",
    ],
    projects: [
      "RNA-seq meta-analysis",
      "Machine learning classification system",
      "Multi-omics biomarker prediction",
    ],
    datasets,
    papers,
  };

  return NextResponse.json(result, { status: 200 });
}
