/**
 * app/api/protein/research-context/route.ts — Phase 5.4B
 *
 * POST /api/protein/research-context
 * Body: {
 *   accession:       string          // proteinAccessionVersion (full, e.g. "NP_000537.3")
 *   transcriptRecord: TranscriptRecord
 *   geneRecord:       GeneRecord
 *   normalizedQuery:  NormalizedQuery | null
 * }
 *
 * Derives a ProteinResearchContext for the given protein accession.
 * The route calls fetchProteinDetail() (one NCBI GenPept EFetch) on the first
 * request for each unique accession, then caches the derived context in-process.
 * Subsequent requests for the same accession hit the in-process cache —
 * zero new NCBI calls after the first derivation.
 *
 * Rate limiting:
 *   Shares the same module-level sequential chain pattern used by the protein
 *   detail route, with a guard that skips the NCBI call when the cache is hot.
 *
 * Version awareness:
 *   The full accession version (e.g. "NP_000537.3") is used as the cache key
 *   suffix, never stripped. Any stripping here would be a cache correctness bug.
 *
 * Error handling:
 *   HTTP 400: invalid accession format
 *   HTTP 400: missing required body fields
 *   HTTP 429: NCBI rate-limited on GenPept fetch
 *   HTTP 502: GenPept fetch failed for any other reason
 *   HTTP 200: always returned for successful derivation (even if annotationConfidence is "unavailable")
 */

import { NextRequest, NextResponse } from "next/server";
import type { ProteinRecord } from "@/types/protein-record";
import type { TranscriptRecord } from "@/types/transcript-record";
import type { GeneRecord } from "@/types/gene-record";
import type { NormalizedQuery } from "@/types/normalized-query";
import { getProteinResearchContext, isResearchContextCached } from "@/lib/protein";
import { fetchProteinDetail } from "@/lib/protein/fetch";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";

// Accepted accession prefixes for db=protein (same as detail route).
const PROTEIN_ACCESSION_RE = /^(NP_|XP_)\d+\.\d+$/;

// ── Server-side sequential rate limiter ────────────────────────────────────────
// Shared module-level chain so concurrent requests are sequentialised,
// matching the pattern in app/api/protein/detail/route.ts.

let contextChain: Promise<void> = Promise.resolve();
let lastContextCallAt = 0;

async function withContextRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = contextChain.then(async () => {
    const waitMs = lastContextCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastContextCallAt = Date.now();
    return task();
  });
  contextChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    accession?: unknown;
    baseRecord?: unknown;
    transcriptRecord?: unknown;
    geneRecord?: unknown;
    normalizedQuery?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accession = typeof body?.accession === "string" ? body.accession.trim() : "";
  if (!PROTEIN_ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing protein accession (expected NP_/XP_ versioned accession)." },
      { status: 400 }
    );
  }

  const baseRecord = body?.baseRecord as ProteinRecord | undefined;
  const transcriptRecord = body?.transcriptRecord as TranscriptRecord | undefined;
  const geneRecord = body?.geneRecord as GeneRecord | undefined;
  const normalizedQuery = (body?.normalizedQuery ?? null) as NormalizedQuery | null;

  if (!baseRecord || typeof baseRecord !== "object") {
    return NextResponse.json(
      { error: "Missing or invalid `baseRecord` in request body." },
      { status: 400 }
    );
  }
  if (!transcriptRecord || typeof transcriptRecord !== "object") {
    return NextResponse.json(
      { error: "Missing or invalid `transcriptRecord` in request body." },
      { status: 400 }
    );
  }
  if (!geneRecord || typeof geneRecord !== "object") {
    return NextResponse.json(
      { error: "Missing or invalid `geneRecord` in request body." },
      { status: 400 }
    );
  }

  // ── Cache-aware fetch: skip the NCBI call entirely on cache hits ─────────────
  if (isResearchContextCached(accession)) {
    // getProteinResearchContext will return the cached result immediately.
    const result = await getProteinResearchContext(
      "",
      baseRecord,
      transcriptRecord,
      geneRecord,
      normalizedQuery
    );
    return NextResponse.json(result, { status: 200 });
  }

  try {
    const result = await withContextRateLimit(async () => {
      // Cache miss — fetch raw GenPept text (one NCBI call), then derive.
      // getProteinResearchContext caches the result so subsequent requests
      // for this accession never reach this branch again.
      const genPeptText = await fetchProteinDetail(accession);
      return getProteinResearchContext(
        genPeptText,
        baseRecord,
        transcriptRecord,
        geneRecord,
        normalizedQuery
      );
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "NCBI rate limit hit — please wait a moment and try again."
          : `Protein research context derivation failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
