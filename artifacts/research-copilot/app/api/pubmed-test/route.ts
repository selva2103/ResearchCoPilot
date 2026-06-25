import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import type { Paper } from "@/types/paper";

// TODO: Extend this route to support:
//   - Abstract retrieval via NCBI EFetch API (rettype=abstract)
//   - DOI lookup via NCBI EFetch or Europe PMC
//   - MeSH terms from ESummary "MeshHeadingList" field
//   - Author keywords from ESummary "KeywordList" field
//   - AI summarization of abstracts via OpenAI API

interface PubMedTestRequest {
  query: string;
}

interface PubMedTestResponse {
  query: string;
  paperCount: number;
  papers: Paper[];
  status: string;
  executionTimeMs: number;
  cached: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as PubMedTestRequest;

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { error: "query is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const query = body.query.trim();
  const result = await searchPubMed(query);

  const response: PubMedTestResponse = {
    query,
    paperCount: result.count,
    papers: result.data,
    status: result.status,
    executionTimeMs: result.executionTimeMs,
    cached: result.cached,
  };

  return NextResponse.json(response, { status: 200 });
}
