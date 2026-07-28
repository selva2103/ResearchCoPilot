/**
 * app/api/gene/go/route.ts — Gene GO Functional Annotations endpoint (Phase 5.6A)
 *
 * POST /api/gene/go
 *
 * Request body:
 *   {
 *     geneId:     string  — NCBI Gene ID (required, numeric string)
 *     geneSymbol: string  — Gene symbol (required, display only)
 *     organism:   string  — Organism scientific name (required, display only)
 *     taxonomyId?: string — Organism taxonomy ID (optional, for future organism guard)
 *   }
 *
 * Response:
 *   {
 *     module:         "gene-go"
 *     status:         "success" | "empty" | "error"
 *     data:           FunctionalAnnotation[]
 *     count:          number
 *     error:          { code, message } | null
 *     cached:         boolean
 *     executionTimeMs: number
 *     timestamp:      string (ISO 8601)
 *   }
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId, geneSymbol, and organism are consumed from the request — this route
 *   never re-resolves gene, transcript, protein, or organism identity.
 *
 * ZERO ADDITIONAL NCBI CALLS AFTER CACHE:
 *   getGeneGoAnnotations() checks its go:{geneId} cache first.
 *   Cache TTL = 24 hours.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGeneGoAnnotations } from "@/lib/gene/go-fetch";
import { isGoAnnotationsCached } from "@/lib/gene/go-fetch";

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
      { status: 400 }
    );
  }

  const geneSymbol =
    typeof body.geneSymbol === "string" ? body.geneSymbol.trim() : "";
  if (!geneSymbol) {
    return NextResponse.json(
      { error: "geneSymbol is required" },
      { status: 400 }
    );
  }

  const organism =
    typeof body.organism === "string" ? body.organism.trim() : "";
  if (!organism) {
    return NextResponse.json(
      { error: "organism is required" },
      { status: 400 }
    );
  }

  // ── Check cache before calling ───────────────────────────────────────────────
  const wasCached = isGoAnnotationsCached(geneId);

  // ── Fetch GO annotations ─────────────────────────────────────────────────────
  try {
    const annotations = await getGeneGoAnnotations(geneId, geneSymbol, organism);

    const executionTimeMs = Math.round(performance.now() - startedAt);
    const status = annotations.length > 0 ? "success" : "empty";

    return NextResponse.json(
      {
        module: "gene-go",
        status,
        data: annotations,
        count: annotations.length,
        error: null,
        cached: wasCached,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit =
      message.includes("429") || message.toLowerCase().includes("rate limit");

    const executionTimeMs = Math.round(performance.now() - startedAt);

    return NextResponse.json(
      {
        module: "gene-go",
        status: "error",
        data: [],
        count: 0,
        error: {
          code: isRateLimit ? "RATE_LIMITED" : "GO_FETCH_FAILED",
          message: isRateLimit
            ? "NCBI rate limit hit — try again in a few seconds."
            : `Failed to retrieve GO annotations: ${message}`,
        },
        cached: false,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
