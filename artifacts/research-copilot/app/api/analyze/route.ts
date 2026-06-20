import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import type { Paper } from "@/types/paper";

// TODO: GEO datasets      — query NCBI GEO DataSets API for relevant expression datasets
// TODO: SRA datasets      — query NCBI SRA for raw sequencing data linked to the topic
// TODO: Europe PMC        — supplement PubMed results with Europe PMC full-text search
// TODO: AI reasoning layer — use OpenAI GPT-4 to generate landscape, emergingAreas,
//                            researchGaps, and projects based on the query + paper abstracts

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

  // Fetch real PubMed papers for the query — returns [] on failure
  const papers = await searchPubMed(query);

  // Mock data for non-paper sections — will be replaced by OpenAI + GEO/SRA API calls
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
