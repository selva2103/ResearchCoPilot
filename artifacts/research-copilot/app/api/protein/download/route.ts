import { NextRequest, NextResponse } from "next/server";

/**
 * app/api/protein/download/route.ts — Protein FASTA download proxy (Phase 5.4A)
 *
 * GET /api/protein/download?accession=NP_000537.3
 *
 * Proxies a single NCBI EFetch call (db=protein rettype=fasta) and streams it
 * back as a downloadable FASTA file. Keeps the NCBI User-Agent and rate-limit
 * sequencing server-side, and avoids CORS issues from direct browser calls.
 *
 * Filename: {accessionVersion}.fasta
 *   e.g. NP_000537.3.fasta
 *
 * Rate limiting: same module-level promise chain as the transcript download route.
 * All protein FASTA downloads are serialized — concurrent clicks queue and space
 * by GENE_RATE_DELAY_MS.
 *
 * Reuses fetchProteinFasta from lib/protein/fetch.ts — no new fetch client.
 */

import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";
import { fetchProteinFasta } from "@/lib/protein/fetch";

const PROTEIN_ACCESSION_RE = /^(NP_|XP_)\d+\.\d+$/;

// ── Server-side sequential rate limiter ───────────────────────────────────────
// Shared across all in-flight protein FASTA downloads for this server instance.

let downloadChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

async function withDownloadRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = downloadChain.then(async () => {
    const waitMs = lastCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
    return task();
  });
  downloadChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const accession = (searchParams.get("accession") ?? "").trim();

  if (!PROTEIN_ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing protein accession (expected NP_/XP_ versioned accession)." },
      { status: 400 }
    );
  }

  try {
    const fastaText = await withDownloadRateLimit(() =>
      fetchProteinFasta(accession)
    );

    if (!fastaText || !fastaText.trim().startsWith(">")) {
      return NextResponse.json(
        { error: `NCBI returned no FASTA sequence for ${accession}.` },
        { status: 502 }
      );
    }

    return new NextResponse(fastaText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${accession}.fasta"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "NCBI rate limit hit — please wait a moment and try again."
          : `Failed to download protein FASTA: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
