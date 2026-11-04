/**
 * app/api/drug-target/pubchem/route.ts - Phase 5.10C
 *
 * POST /api/drug-target/pubchem
 * Body: { chemblId: string }   // CHEMBL + digits
 * Returns whether PubChem has exactly one record with a computed 3D conformer for the drug.
 * An upstream failure is returned inside the result (availability "source-failure"), not as HTTP error.
 */

import { NextRequest, NextResponse } from "next/server";
import { CHEMBL_ID_RE } from "@/lib/drug-target/extras";
import { getPubChemResult, isPubChemCached } from "@/lib/drug-target/pubchem";

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
  const cached = isPubChemCached(chemblId);
  const result = await getPubChemResult(chemblId);
  return NextResponse.json({ ...result, cached, executionTimeMs: Date.now() - started });
}
