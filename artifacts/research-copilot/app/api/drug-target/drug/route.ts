/**
 * app/api/drug-target/drug/route.ts - Phase 5.10B
 *
 * POST /api/drug-target/drug
 * Body: { chemblId: string }   // CHEMBL + digits
 * Returns the indications of one drug (drug-level, not gene-specific). An Open Targets
 * failure is returned inside the result (availability "source-failure"), not as HTTP error.
 */

import { NextRequest, NextResponse } from "next/server";
import { CHEMBL_ID_RE, getDrugIndications, isIndicationsCached } from "@/lib/drug-target/extras";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let body: { chemblId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const chemblId = typeof body?.chemblId === "string" ? body.chemblId.trim() : "";
  if (!CHEMBL_ID_RE.test(chemblId)) {
    return NextResponse.json(
      { error: "Invalid or missing chemblId (expected CHEMBL followed by digits)." },
      { status: 400 }
    );
  }
  const cached = isIndicationsCached(chemblId);
  const result = await getDrugIndications(chemblId);
  return NextResponse.json({ ...result, cached, executionTimeMs: Date.now() - started });
}
