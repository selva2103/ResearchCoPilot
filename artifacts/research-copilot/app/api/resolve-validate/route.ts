/**
 * /api/resolve-validate — Validation-only endpoint for Phase 5.1.5 test suite.
 *
 * Accepts: POST { query: string }
 * Returns: QueryResolution (the raw resolver output, no downstream modules)
 *
 * This route is NOT exposed in the OpenAPI spec — it is used exclusively by
 * scripts/validate-resolver.js for the Phase 5.1.5 validation suite.
 * Remove or restrict in production if a public API is deployed.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveQuery } from "@/lib/resolver";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { query?: unknown };

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { error: "query must be a non-empty string" },
      { status: 400 }
    );
  }

  const resolution = await resolveQuery(body.query.trim());
  return NextResponse.json(resolution, { status: 200 });
}
