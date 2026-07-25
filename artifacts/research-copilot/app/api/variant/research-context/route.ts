/**
 * app/api/variant/research-context/route.ts — VariantResearchContext endpoint (Phase 5.5B-2)
 *
 * POST /api/variant/research-context
 *
 * Request body:
 *   {
 *     clinvarVariationId: string   — numeric ClinVar Variation ID (required)
 *     clinvarAccession?:  string   — VCV-prefixed accession (optional, auto-constructed if absent)
 *     taxonomyId?:        string   — organism taxonomy ID (for non-human guard)
 *     variantRecord:      object   — the VariantRecord for this variant (already in client state)
 *   }
 *
 * Response: { data: VariantResearchContext, status, error?, cached }
 *
 * NON-HUMAN GUARD: taxonomyId ≠ "9606" → empty response.
 * Consistent with clinical-evidence route and variant-list route.
 *
 * ZERO NEW NCBI CALLS:
 *   getVariantResearchContext() reuses getClinicalEvidence() from lib/clinical-evidence,
 *   which uses the existing clinicalevidence:{id} cache. If the user already expanded
 *   CE for this variant, the CE fetch is free (cache hit). If not, one VCV EFetch call
 *   is made — the same call the CE endpoint would make. No new API surface is introduced.
 */

import { NextRequest, NextResponse } from "next/server";
import { getVariantResearchContext } from "@/lib/variant-research-context";
import type { VariantRecord } from "@/types/variant-record";

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
          message: "Variant research context is not available for non-human organisms.",
        },
        cached: false,
      },
      { status: 200 }
    );
  }

  // ── Validate variantRecord ──────────────────────────────────────────────────
  const variantRecord = body.variantRecord as VariantRecord | undefined;
  if (!variantRecord || typeof variantRecord !== "object") {
    return NextResponse.json(
      { error: "variantRecord is required" },
      { status: 400 }
    );
  }

  // ── Derive context ──────────────────────────────────────────────────────────
  try {
    const ctx = await getVariantResearchContext(
      clinvarVariationId,
      clinvarAccession,
      variantRecord
    );

    return NextResponse.json(
      {
        status: "success",
        data: ctx,
        error: null,
        cached: false,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: "error",
        data: null,
        error: {
          code: "CONTEXT_DERIVATION_FAILED",
          message: `Failed to derive variant research context: ${message}`,
        },
        cached: false,
      },
      { status: 200 }
    );
  }
}
