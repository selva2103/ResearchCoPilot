/**
 * app/api/drug-target/tractability/route.ts - Phase 5.10B
 *
 * POST /api/drug-target/tractability
 * Body: { ensemblId: string, geneId: string, taxonomyId: string | number }
 * ensemblId must be ENSG + 11 digits; taxonomyId must be 9606, otherwise availability
 * "not-applicable". An Open Targets failure is returned inside the result, not as HTTP error.
 */

import { NextRequest, NextResponse } from "next/server";
import { ENSEMBL_HUMAN_GENE_RE } from "@/lib/drug-target/fetch";
import { getTractabilityResult, isTractabilityCached } from "@/lib/drug-target/extras";
import type { TractabilityResult } from "@/types/drug-target-extras";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let body: { ensemblId?: unknown; geneId?: unknown; taxonomyId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ensemblId = typeof body?.ensemblId === "string" ? body.ensemblId.trim() : "";
  const geneId = typeof body?.geneId === "string" ? body.geneId.trim() : "";
  const taxRaw =
    typeof body?.taxonomyId === "number"
      ? String(body.taxonomyId)
      : typeof body?.taxonomyId === "string"
        ? body.taxonomyId.trim()
        : "";
  if (!ENSEMBL_HUMAN_GENE_RE.test(ensemblId)) {
    return NextResponse.json(
      { error: "Invalid or missing ensemblId (expected a human Ensembl gene ID: ENSG + 11 digits)." },
      { status: 400 }
    );
  }
  if (!geneId) {
    return NextResponse.json({ error: "Missing geneId in request body." }, { status: 400 });
  }
  if (taxRaw !== "9606") {
    const na: TractabilityResult = {
      ensemblId,
      availability: "not-applicable",
      dataVersion: null,
      assessedCount: 0,
      positives: [],
    };
    return NextResponse.json({ ...na, cached: false, executionTimeMs: Date.now() - started });
  }
  const cached = isTractabilityCached(ensemblId);
  const result = await getTractabilityResult(ensemblId);
  return NextResponse.json({ ...result, cached, executionTimeMs: Date.now() - started });
}
