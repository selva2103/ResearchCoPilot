/**
 * app/api/variant/list/route.ts — Variant list endpoint (Phase 5.5A)
 *
 * POST /api/variant/list
 *
 * Request body:
 *   {
 *     geneId:              string              — NCBI Gene ID (required)
 *     taxonomyId?:         string              — organism taxonomy ID (for human check)
 *     offset?:             number              — zero-based pagination offset (default: 0)
 *     pageSize?:           number              — records per page (default: 20, max: 100)
 *     significanceFilter?: string | null       — ClinVar clinical significance filter
 *     variantTypeFilter?:  string | null       — ClinVar variant type filter
 *     sort?:               "default"|"relevance"
 *   }
 *
 * Response: ModuleResult<VariantRecord> — same shape as all other scientific module results.
 *
 * Non-human guard:
 *   ClinVar is human-centric. When taxonomyId is provided and is NOT "9606" (Homo sapiens),
 *   this endpoint returns status="empty" with an explicit "non_human" error code — never
 *   calling ClinVar. The UI shows "Variant data not available for non-human organisms."
 *
 * Rate limit:
 *   Two sequential NCBI calls: ESearch (page IDs) + ESummary (batch summary).
 *   The variant module is self-rate-limited (350ms between calls).
 *   This route should NOT be called concurrently with the analyze route for the same session.
 *
 * Performance gate:
 *   For BRCA1 (15,986 total variants), page 1 = 2 NCBI calls regardless of total count.
 *   hitUpstreamLimit activates when offset + pageSize > 9999.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  searchVariants,
} from "@/lib/variant";
import type {
  ClinVarSignificanceFilter,
  ClinVarVariantTypeFilter,
  ClinVarSortOption,
} from "@/types/variant-record";

const HUMAN_TAXONOMY_ID = "9606";

// Valid significance filter values (from live API audit 2026-07-11)
const VALID_SIGNIFICANCE_FILTERS = new Set<string>([
  "pathogenic",
  "likely pathogenic",
  "benign",
  "likely benign",
  "uncertain significance",
]);

// Valid variant type filter values
const VALID_VARIANTTYPE_FILTERS = new Set<string>([
  "single nucleotide variant",
  "deletion",
  "insertion",
  "indel",
  "duplication",
]);

const VALID_SORT_OPTIONS = new Set<string>(["default", "relevance"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const geneId = typeof body.geneId === "string" ? body.geneId.trim() : "";
  if (!geneId || !/^\d+$/.test(geneId)) {
    return NextResponse.json(
      { error: "geneId is required and must be a numeric string" },
      { status: 400 }
    );
  }

  // ── Non-human guard ─────────────────────────────────────────────────────────
  const taxonomyId = typeof body.taxonomyId === "string" ? body.taxonomyId.trim() : null;
  if (taxonomyId && taxonomyId !== HUMAN_TAXONOMY_ID) {
    return NextResponse.json(
      {
        module: "clinvar-variants",
        status: "empty",
        data: [],
        count: 0,
        error: {
          code: "NON_HUMAN_ORGANISM",
          message:
            "ClinVar variant data is not available for non-human organisms. " +
            "ClinVar is a human-centric database (Homo sapiens only).",
        },
        executionTimeMs: 0,
        cached: false,
        timestamp: new Date().toISOString(),
        totalCount: 0,
        pageSize: 20,
        offset: 0,
        hasMore: false,
        hitUpstreamLimit: false,
      },
      { status: 200 }
    );
  }

  // ── Pagination params ───────────────────────────────────────────────────────
  const offset =
    typeof body.offset === "number" && body.offset >= 0
      ? Math.floor(body.offset)
      : 0;
  const pageSize =
    typeof body.pageSize === "number" && body.pageSize > 0
      ? Math.min(Math.floor(body.pageSize), 100)
      : 20;

  // ── Filter + sort params ────────────────────────────────────────────────────
  const rawSigFilter = typeof body.significanceFilter === "string"
    ? body.significanceFilter.trim().toLowerCase()
    : null;
  const significanceFilter: ClinVarSignificanceFilter | null =
    rawSigFilter && VALID_SIGNIFICANCE_FILTERS.has(rawSigFilter)
      ? (rawSigFilter as ClinVarSignificanceFilter)
      : null;

  const rawTypeFilter = typeof body.variantTypeFilter === "string"
    ? body.variantTypeFilter.trim().toLowerCase()
    : null;
  const variantTypeFilter: ClinVarVariantTypeFilter | null =
    rawTypeFilter && VALID_VARIANTTYPE_FILTERS.has(rawTypeFilter)
      ? (rawTypeFilter as ClinVarVariantTypeFilter)
      : null;

  const rawSort = typeof body.sort === "string" ? body.sort.trim().toLowerCase() : "default";
  const sort: ClinVarSortOption = VALID_SORT_OPTIONS.has(rawSort)
    ? (rawSort as ClinVarSortOption)
    : "default";

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const result = await searchVariants(geneId, {
    offset,
    pageSize,
    significanceFilter,
    variantTypeFilter,
    sort,
  });

  return NextResponse.json(result, { status: 200 });
}
