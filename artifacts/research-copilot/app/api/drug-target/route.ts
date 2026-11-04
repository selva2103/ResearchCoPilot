/**
 * app/api/drug-target/route.ts - Phase 5.10A
 *
 * POST /api/drug-target
 * Body: {
 *   ensemblId:  string          // human Ensembl gene ID, ENSG + 11 digits
 *   geneId:     string          // NCBI Gene ID (traceability)
 *   organism:   string          // organism scientific name (traceability)
 *   taxonomyId: string | number // must be 9606; other taxa get availability "not-applicable"
 * }
 *
 * Returns a DrugTargetResult (types/drug-target.ts) plus cached / executionTimeMs.
 * An Open Targets failure is reported inside the result (availability "source-failure"),
 * not as an HTTP error. Only invalid input returns 400.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ENSEMBL_HUMAN_GENE_RE,
  getDrugTargetResult,
  isDrugTargetCached,
} from "@/lib/drug-target/fetch";
import type { DrugTargetResult } from "@/types/drug-target";

const HUMAN_TAXON = "9606";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let body: {
    ensemblId?: unknown;
    geneId?: unknown;
    organism?: unknown;
    taxonomyId?: unknown;
  };
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

  if (taxRaw !== HUMAN_TAXON) {
    const notApplicable: DrugTargetResult = {
      ensemblId,
      approvedSymbol: null,
      availability: "not-applicable",
      sourceStatus: "not-attempted",
      dataVersion: null,
      totalCount: 0,
      candidates: [],
    };
    return NextResponse.json({ ...notApplicable, cached: false, executionTimeMs: Date.now() - started });
  }

  const cached = isDrugTargetCached(ensemblId);
  const result = await getDrugTargetResult(ensemblId);
  return NextResponse.json({ ...result, cached, executionTimeMs: Date.now() - started });
}
