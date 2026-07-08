import { NextRequest, NextResponse } from "next/server";

/**
 * app/api/protein/summaries/route.ts — Protein batch summary (Phase 5.4A)
 *
 * POST /api/protein/summaries
 * Body: { transcripts: TranscriptRecord[] }
 *
 * Called once when a gene's transcript accordion is first expanded (if not already
 * fetched in this session). Fetches ESummary for ALL protein-coding transcripts in
 * that gene in a single batched NCBI call and returns an array of ProteinRecord[].
 *
 * Rate limiting: the same module-level promise chain used by the transcript
 * download and summary routes — serializes concurrent requests to prevent
 * simultaneous NCBI calls from rapid user interaction.
 */

import type { TranscriptRecord } from "@/types/transcript-record";
import { getProteinsForTranscripts } from "@/lib/protein";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";

// ── Server-side sequential rate limiter ───────────────────────────────────────

let summaryChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

async function withSummaryRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = summaryChain.then(async () => {
    const waitMs = lastCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
    return task();
  });
  summaryChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { transcripts?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (!Array.isArray(body?.transcripts)) {
    return NextResponse.json(
      { error: "Missing or invalid `transcripts` array in request body." },
      { status: 400 }
    );
  }

  const transcripts = body.transcripts as TranscriptRecord[];

  try {
    const result = await withSummaryRateLimit(() =>
      getProteinsForTranscripts(transcripts)
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
          : `Protein summary fetch failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
