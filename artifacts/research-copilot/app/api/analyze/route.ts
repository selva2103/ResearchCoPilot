import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import type { Paper } from "@/types/paper";

// TODO: GEO integration         — query NCBI GEO DataSets API for expression datasets
// TODO: SRA integration         — query NCBI SRA for raw sequencing data
// TODO: ArrayExpress integration — query EBI ArrayExpress for transcriptomics experiments
// TODO: Europe PMC integration  — supplement PubMed with Europe PMC full-text search
// TODO: AI reasoning layer      — use OpenAI GPT-4 to generate landscape, emergingAreas,
//                                  researchGaps, and projects from the query + paper abstracts

interface AnalyzeRequest {
  query: string;
}

interface AnalyzeResponse {
  landscape: string[];
  emergingAreas: string[];
  researchGaps: string[];
  projects: string[];
  datasets: string[];
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

  // Live PubMed pipeline: ESearch → ESummary + EFetch (parallel) → Paper[]
  const papers = await searchPubMed(query);

  // Mock data — will be replaced by OpenAI + GEO/SRA/ArrayExpress API calls
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
    datasets: [
      "TCGA-BRCA",
      "GEO GSE12345",
      "ArrayExpress E-MTAB-5678",
    ],
    papers,
  };

  return NextResponse.json(result, { status: 200 });
}
