import { NextRequest, NextResponse } from "next/server";

/**
 * app/api/transcript/download/route.ts — Transcript sequence download (Phase 5.3B Part 1)
 *
 * GET /api/transcript/download?accession=NM_000546.6&type=fasta|cds
 *
 * Proxies a single NCBI EFetch call (db=nuccore) for one transcript's sequence and
 * streams it back as a downloadable plain-text FASTA file. This keeps the NCBI
 * User-Agent header and rate-limit sequencing server-side, and avoids CORS issues
 * that would occur calling eutils.ncbi.nlm.nih.gov directly from the browser.
 *
 * type=fasta → rettype=fasta          (full transcript sequence, any accession)
 * type=cds   → rettype=fasta_cds_na   (coding sequence only; NM_/XM_ only —
 *                                       rejected with 400 for NR_/XR_)
 *
 * Rate limiting: all downloads funnel through the SAME GENE_RATE_DELAY_MS/sleep
 * pattern used by the rest of the Gene/Transcript modules (lib/gene/search.ts).
 * A module-level promise chain serializes concurrent requests to this route so
 * that rapid double-clicks (or clicks across multiple transcript rows) never
 * fire concurrent NCBI calls — they are queued and spaced by GENE_RATE_DELAY_MS.
 */

import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";
import { fetchTranscriptSequence } from "@/lib/transcript/fetch";

const ACCESSION_RE = /^(NM_|NR_|XM_|XR_)\d+\.\d+$/;

// ── Server-side sequential rate limiter (module-scoped, shared across requests) ──
let downloadChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

async function withDownloadRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = downloadChain.then(async () => {
    const waitMs = lastCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
    return task();
  });
  // Keep the chain alive even if this task fails — next queued download must still run.
  downloadChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const accession = (searchParams.get("accession") ?? "").trim();
  const type = searchParams.get("type") ?? "fasta";

  if (!ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing transcript accession." },
      { status: 400 }
    );
  }

  if (type !== "fasta" && type !== "cds") {
    return NextResponse.json(
      { error: "Invalid download type — expected 'fasta' or 'cds'." },
      { status: 400 }
    );
  }

  const isCodingAccession = accession.startsWith("NM_") || accession.startsWith("XM_");
  if (type === "cds" && !isCodingAccession) {
    return NextResponse.json(
      {
        error:
          "CDS download is not available for non-coding transcripts (NR_/XR_). This is not an error — non-coding RNAs have no coding sequence.",
      },
      { status: 400 }
    );
  }

  const rettype = type === "cds" ? "fasta_cds_na" : "fasta";

  try {
    const fastaText = await withDownloadRateLimit(() =>
      fetchTranscriptSequence(accession, rettype)
    );

    if (!fastaText || !fastaText.trim().startsWith(">")) {
      return NextResponse.json(
        {
          error: `NCBI returned no ${
            type === "cds" ? "CDS" : "FASTA"
          } sequence for ${accession}.`,
        },
        { status: 502 }
      );
    }

    const suffix = type === "cds" ? "_cds" : "";
    return new NextResponse(fastaText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${accession}${suffix}.fasta"`,
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
          : `Failed to download sequence: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
