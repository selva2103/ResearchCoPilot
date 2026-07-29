/**
 * app/api/gene/pathways/route.ts — Gene Pathway Membership endpoint (Phase 5.6B)
 *
 * POST /api/gene/pathways
 *
 * Request body:
 *   {
 *     geneId:     string  — NCBI Gene ID (required, numeric string)
 *     geneSymbol: string  — Gene symbol (required, used as Reactome input)
 *     organism:   string  — Organism scientific name (required, display only)
 *   }
 *
 * Response:
 *   {
 *     module:         "gene-pathways"
 *     status:         "success" | "empty" | "error"
 *     data:           PathwayMembership[]
 *     count:          number
 *     error:          { code, message } | null
 *     cached:         boolean
 *     executionTimeMs: number
 *     timestamp:      string (ISO 8601)
 *   }
 *
 * SOURCE: Reactome Analysis Service — POST /AnalysisService/identifiers/
 * Full rationale in PHASE-5.6B-AUDIT-FINDINGS.md.
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId and geneSymbol are consumed from the request (caller-resolved).
 *   This route never re-resolves gene, organism, or pathway identity.
 *
 * NO ORGANISM GUARD:
 *   Reactome covers non-human model organisms natively (confirmed: Trp53/mouse
 *   returns 51 R-MMU-* pathways). No human-only restriction is applied.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGenePathways, isPathwayCached } from "@/lib/gene/pathway-fetch";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = performance.now();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate required fields ─────────────────────────────────────────────────
  const geneId =
    typeof body.geneId === "string" ? body.geneId.trim() : "";
  if (!geneId || !/^\d+$/.test(geneId)) {
    return NextResponse.json(
      { error: "geneId is required and must be a numeric string" },
      { status: 400 },
    );
  }

  const geneSymbol =
    typeof body.geneSymbol === "string" ? body.geneSymbol.trim() : "";
  if (!geneSymbol) {
    return NextResponse.json(
      { error: "geneSymbol is required" },
      { status: 400 },
    );
  }

  const organism =
    typeof body.organism === "string" ? body.organism.trim() : "";
  if (!organism) {
    return NextResponse.json(
      { error: "organism is required" },
      { status: 400 },
    );
  }

  // ── Cache check before calling ───────────────────────────────────────────────
  const wasCached = isPathwayCached(geneId);

  // ── Fetch pathway memberships ────────────────────────────────────────────────
  try {
    const pathways = await getGenePathways(geneId, geneSymbol, organism);

    const executionTimeMs = Math.round(performance.now() - startedAt);
    const status = pathways.length > 0 ? "success" : "empty";

    return NextResponse.json(
      {
        module: "gene-pathways",
        status,
        data: pathways,
        count: pathways.length,
        error: null,
        cached: wasCached,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit =
      message.includes("429") || message.toLowerCase().includes("rate limit");

    const executionTimeMs = Math.round(performance.now() - startedAt);

    return NextResponse.json(
      {
        module: "gene-pathways",
        status: "error",
        data: [],
        count: 0,
        error: {
          code: isRateLimit ? "RATE_LIMITED" : "PATHWAY_FETCH_FAILED",
          message: isRateLimit
            ? "Reactome rate limit hit — try again in a few seconds."
            : `Failed to retrieve pathway memberships: ${message}`,
        },
        cached: false,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
}
