/**
 * app/api/clinical-evidence/route.ts — Clinical Evidence endpoint (Phase 5.5B-1)
 *
 * POST /api/clinical-evidence
 *
 * Request body:
 *   {
 *     clinvarVariationId:  string   — numeric ClinVar Variation ID (required)
 *     clinvarAccession?:   string   — VCV-prefixed accession (e.g. "VCV004685939")
 *     taxonomyId?:         string   — organism taxonomy ID (for non-human guard)
 *   }
 *
 * Response: { data: ClinicalEvidence | null, status, error?, cached }
 *
 * NON-HUMAN GUARD: taxonomyId ≠ "9606" → empty response, no ClinVar call.
 * Consistent with 5.5A's variant list route.
 *
 * LAZY LOADING CONTRACT: This endpoint is called only when a user explicitly
 * expands a variant to view its clinical evidence. It is never called during
 * variant list loading. The response includes both RCV metadata and SCV submissions
 * (bundled in one VCV EFetch call — no split is possible per the 5.5B-1 audit).
 */

import { NextRequest, NextResponse } from "next/server";
import { getClinicalEvidence } from "@/lib/clinical-evidence";

const HUMAN_TAXONOMY_ID = "9606";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clinvarVariationId =
    typeof body.clinvarVariationId === "string"
      ? body.clinvarVariationId.trim()
      : "";

  if (!clinvarVariationId || !/^\d+$/.test(clinvarVariationId)) {
    return NextResponse.json(
      { error: "clinvarVariationId is required and must be a numeric string" },
      { status: 400 }
    );
  }

  const clinvarAccession =
    typeof body.clinvarAccession === "string"
      ? body.clinvarAccession.trim()
      : null;

  // ── Non-human guard ─────────────────────────────────────────────────────────
  const taxonomyId =
    typeof body.taxonomyId === "string" ? body.taxonomyId.trim() : null;
  if (taxonomyId && taxonomyId !== HUMAN_TAXONOMY_ID) {
    return NextResponse.json(
      {
        status: "empty",
        data: null,
        error: {
          code: "NON_HUMAN_ORGANISM",
          message:
            "ClinVar clinical evidence is not available for non-human organisms.",
        },
        cached: false,
      },
      { status: 200 }
    );
  }

  // ── Fetch clinical evidence ─────────────────────────────────────────────────
  try {
    const evidence = await getClinicalEvidence(
      clinvarVariationId,
      clinvarAccession
    );

    if (evidence === null) {
      return NextResponse.json(
        {
          status: "error",
          data: null,
          error: {
            code: "PARSE_FAILED",
            message: "ClinVar returned an unparseable response for this variant.",
          },
          cached: false,
        },
        { status: 200 }
      );
    }

    if (evidence.interpretations.length === 0) {
      return NextResponse.json(
        {
          status: "empty",
          data: evidence,
          error: null,
          cached: false,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: "success",
        data: evidence,
        error: null,
        cached: false,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit = message.includes("429") || message.toLowerCase().includes("rate");
    return NextResponse.json(
      {
        status: "error",
        data: null,
        error: {
          code: isRateLimit ? "RATE_LIMITED" : "CLINVAR_FETCH_FAILED",
          message: isRateLimit
            ? "NCBI rate limit reached. Please try again in a moment."
            : `Failed to retrieve clinical evidence: ${message}`,
        },
        cached: false,
      },
      { status: 200 }
    );
  }
}
