/**
 * app/api/protein/interactions/route.ts - Phase 5.9A
 *
 * POST /api/protein/interactions
 * Body: {
 *   accession:  string   // RefSeq protein accession (NP_/XP_ versioned)
 *   geneId:     string   // NCBI Gene ID (traceability)
 *   organism:   string   // organism scientific name (traceability)
 *   taxonomyId: string | number   // NCBI Taxonomy ID, e.g. "9606"
 *   minScore?:  number   // 0-1000, default 700
 *   limit?:     number   // 1-50, default 20
 * }
 *
 * Returns an InteractionResolutionResult (types/protein-interaction.ts) plus
 * cached / executionTimeMs. A STRING failure is reported inside the result
 * (availability "source-failure"), not as an HTTP error; only identifier-resolution
 * failures return 429/502.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveProteinIdentifier } from "@/lib/protein/identifier-resolver";
import {
  getProteinInteractionResult,
  isInteractionCached,
} from "@/lib/protein/interaction-fetch";

const PROTEIN_ACCESSION_RE = /^(NP_|XP_)\d+\.\d+$/;
const DEFAULT_MIN_SCORE = 700;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    accession?: unknown;
    geneId?: unknown;
    organism?: unknown;
    taxonomyId?: unknown;
    minScore?: unknown;
    limit?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accession = typeof body?.accession === "string" ? body.accession.trim() : "";
  const geneId = typeof body?.geneId === "string" ? body.geneId.trim() : "";
  const organism = typeof body?.organism === "string" ? body.organism.trim() : "";
  const taxRaw =
    typeof body?.taxonomyId === "number" ? String(body.taxonomyId) : typeof body?.taxonomyId === "string" ? body.taxonomyId.trim() : "";

  if (!PROTEIN_ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing protein accession (expected NP_/XP_ versioned accession)." },
      { status: 400 }
    );
  }
  if (!geneId) {
    return NextResponse.json({ error: "Missing geneId in request body." }, { status: 400 });
  }
  if (!organism) {
    return NextResponse.json({ error: "Missing organism in request body." }, { status: 400 });
  }
  if (!/^\d{1,9}$/.test(taxRaw)) {
    return NextResponse.json({ error: "Invalid or missing taxonomyId." }, { status: 400 });
  }
  const taxonId = parseInt(taxRaw, 10);

  let minScore = DEFAULT_MIN_SCORE;
  if (body.minScore !== undefined) {
    if (typeof body.minScore !== "number" || !Number.isInteger(body.minScore) || body.minScore < 0 || body.minScore > 1000) {
      return NextResponse.json({ error: "minScore must be an integer between 0 and 1000." }, { status: 400 });
    }
    minScore = body.minScore;
  }
  let limit = DEFAULT_LIMIT;
  if (body.limit !== undefined) {
    if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > MAX_LIMIT) {
      return NextResponse.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}.` }, { status: 400 });
    }
    limit = body.limit;
  }

  const startTime = Date.now();

  try {
    const mapping = await resolveProteinIdentifier(accession);
    const wasCached =
      mapping.resolutionStatus === "resolved" &&
      isInteractionCached(mapping.refseqAccession, taxonId, minScore, limit);
    const result = await getProteinInteractionResult(mapping, taxonId, minScore, limit);

    return NextResponse.json(
      {
        ...result,
        geneId,
        organism,
        cached: wasCached,
        executionTimeMs: Date.now() - startTime,
      },
      { status: 200 }
    );
  } catch (err) {
    // Only reached if identifier resolution itself throws (network/timeout).
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited = message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "Rate limit hit — please wait a moment and try again."
          : `Protein interaction retrieval failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
