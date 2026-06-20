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
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as PubMedTestRequest;

    if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
      return NextResponse.json(
        { error: "query is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    const query = body.query.trim();
    const papers = await searchPubMed(query);

    const result: PubMedTestResponse = {
      query,
      paperCount: papers.length,
      papers,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[/api/pubmed-test] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
