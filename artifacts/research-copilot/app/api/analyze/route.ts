import { NextRequest, NextResponse } from "next/server";

// TypeScript types for the request and response
interface AnalyzeRequest {
  query: string;
}

interface AnalyzeResponse {
  landscape: string[];
  emergingAreas: string[];
  researchGaps: string[];
  projects: string[];
  datasets: string[];
}

// TODO: Replace mock data with OpenAI API integration (GPT-4) to generate
// landscape, emergingAreas, researchGaps, and projects based on the query.

// TODO: Replace mock datasets with PubMed/GEO API integration to fetch
// real public datasets relevant to the query topic.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as AnalyzeRequest;

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { error: "query is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  // Mock response — will be replaced by OpenAI + PubMed API calls
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
  };

  return NextResponse.json(result, { status: 200 });
}
