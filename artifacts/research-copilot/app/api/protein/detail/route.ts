import { NextRequest, NextResponse } from "next/server";

/**
 * app/api/protein/detail/route.ts — On-demand protein GenPept detail (Phase 5.4A)
 *
 * POST /api/protein/detail
 * Body: { accession: string; baseRecord: ProteinRecord }
 *
 * Called only when the user explicitly expands a specific protein sub-panel.
 * Fetches GenPept for one protein, enriches the provided base ProteinRecord
 * with proteinName, molecularWeight, and length, and returns the enriched record.
 *
 * Rate limiting: module-level sequential chain, same pattern as transcript routes.
 */

import type { ProteinRecord } from "@/types/protein-record";
import { getProteinDetail } from "@/lib/protein";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";

// Accepted accession prefixes for db=protein.
const PROTEIN_ACCESSION_RE = /^(NP_|XP_)\d+\.\d+$/;

// ── Server-side sequential rate limiter ───────────────────────────────────────

let detailChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

async function withDetailRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = detailChain.then(async () => {
    const waitMs = lastCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
    return task();
  });
  detailChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { accession?: unknown; baseRecord?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accession = typeof body?.accession === "string" ? body.accession.trim() : "";
  const baseRecord = body?.baseRecord as ProteinRecord | undefined;

  if (!PROTEIN_ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing protein accession (expected NP_/XP_ versioned accession)." },
      { status: 400 }
    );
  }

  if (!baseRecord || typeof baseRecord !== "object") {
    return NextResponse.json(
      { error: "Missing or invalid `baseRecord` in request body." },
      { status: 400 }
    );
  }

  try {
    const result = await withDetailRateLimit(() =>
      getProteinDetail(accession, baseRecord)
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "NCBI rate limit hit — please wait a moment and try again."
          : `Protein detail fetch failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
