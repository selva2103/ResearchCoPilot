/**
 * app/api/gene/fasta/route.ts — Gene region FASTA download (Gene FASTA task)
 *
 * GET /api/gene/fasta?accession={chraccver}&start={genomicStart}&stop={genomicEnd}&strand={1|2}&symbol={officialSymbol}
 *
 * Proxies a single NCBI EFetch call (db=nuccore) with seq_start/seq_stop range
 * parameters to download the genomic DNA sequence spanning a gene's coordinates
 * (including introns). Returns plain-text FASTA with Content-Disposition so the
 * browser saves it as a file.
 *
 * This is NOT transcript FASTA, CDS FASTA, or protein FASTA — those already
 * exist at other endpoints. This fetches the genomic region only.
 *
 * Coordinate convention:
 *   GeneRecord.genomicStart / .genomicEnd are 0-based (from NCBI ESummary
 *   genomicinfo[0].chrstart/chrstop, 0-based half-open convention).
 *   NCBI EFetch seq_start/seq_stop are 1-based inclusive.
 *   Conversion: seq_start = genomicStart + 1, seq_stop = genomicEnd
 *   (0-based exclusive end = 1-based inclusive end — same numeric value).
 *
 * Strand convention (NCBI EFetch):
 *   strand=1 → plus strand
 *   strand=2 → minus strand (EFetch returns reverse complement of the region)
 *
 * Rate limiting: uses the same GENE_RATE_DELAY_MS / sleep pattern and a
 * module-scoped promise chain as app/api/transcript/download/route.ts, so
 * rapid clicks are queued rather than triggering concurrent NCBI calls.
 *
 * Filename: {symbol}_{accession}.fasta — e.g. TP53_NC_000017.11.fasta
 */

import { NextRequest, NextResponse } from "next/server";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// ── Server-side sequential rate limiter (shared across requests) ──────────────
let downloadChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;

async function withRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = downloadChain.then(async () => {
    const waitMs = lastCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
    return task();
  });
  downloadChain = runPromise.then(() => undefined, () => undefined);
  return runPromise;
}

async function fetchGeneRegionFasta(
  accession: string,
  seqStart: number,
  seqStop: number,
  strand: 1 | 2
): Promise<string> {
  const url =
    `${NCBI_BASE}/efetch.fcgi?db=nuccore` +
    `&id=${encodeURIComponent(accession)}` +
    `&rettype=fasta&retmode=text` +
    `&seq_start=${seqStart}&seq_stop=${seqStop}&strand=${strand}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
    throw new Error(`HTTP ${res.status} from NCBI nuccore: ${accession}`);
  }

  return res.text();
}

// ── Validation helpers ────────────────────────────────────────────────────────

/** NC_, NG_, NT_, NW_, NZ_ — valid chromosome/scaffold RefSeq accessions */
const GENOMIC_ACCESSION_RE = /^(NC|NG|NT|NW|NZ)_\d+\.\d+$/;

/** Rough bound: human chromosomes are ~200 Mbp, gene regions never exceed that */
const MAX_COORD = 300_000_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const accession = (searchParams.get("accession") ?? "").trim();
  const startParam = searchParams.get("start");
  const stopParam  = searchParams.get("stop");
  const strandParam = searchParams.get("strand");
  const symbol = (searchParams.get("symbol") ?? "gene").trim().replace(/[^A-Za-z0-9_\-]/g, "");

  // ── Input validation ────────────────────────────────────────────────────────
  if (!GENOMIC_ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing genomic accession. Expected NC_/NG_/NT_/NW_/NZ_ format." },
      { status: 400 }
    );
  }

  const start = Number(startParam);
  const stop  = Number(stopParam);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || start < 0 || stop < 0) {
    return NextResponse.json(
      { error: "start and stop must be non-negative integers." },
      { status: 400 }
    );
  }
  if (start >= stop) {
    return NextResponse.json(
      { error: "start must be less than stop." },
      { status: 400 }
    );
  }
  if (start > MAX_COORD || stop > MAX_COORD) {
    return NextResponse.json(
      { error: "Coordinates out of expected range for a genomic accession." },
      { status: 400 }
    );
  }

  const strandNum = strandParam === "2" ? 2 : 1;

  // Convert 0-based genomicStart/genomicEnd → 1-based EFetch coordinates.
  // genomicStart (0-based inclusive) → seq_start = genomicStart + 1
  // genomicEnd   (0-based exclusive) → seq_stop  = genomicEnd   (same value)
  const seqStart = Math.floor(start) + 1;
  const seqStop  = Math.floor(stop);

  try {
    const fastaText = await withRateLimit(() =>
      fetchGeneRegionFasta(accession, seqStart, seqStop, strandNum as 1 | 2)
    );

    if (!fastaText || !fastaText.trim().startsWith(">")) {
      return NextResponse.json(
        { error: `NCBI returned no FASTA sequence for ${accession} at this range.` },
        { status: 502 }
      );
    }

    const filename = `${symbol}_${accession}.fasta`;

    return new NextResponse(fastaText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
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
          : `Failed to download gene FASTA: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
