import { NextRequest, NextResponse } from "next/server";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";

/**
 * app/api/transcript/summary/route.ts — Lazy transcript summary fetch (Phase 5.3B Part 2)
 *
 * GET /api/transcript/summary?accession=NM_000546.6
 *
 * Returns the RefSeq COMMENT text for a single transcript via NCBI nuccore EFetch
 * (rettype=gb). Called lazily on expand — NEVER on initial page load.
 *
 * Source investigation (confirmed 2026-07-03):
 *   - nuccore ESummary does NOT include a `comment` field for RefSeq records.
 *   - The RefSeq summary/variant description is ONLY available via EFetch
 *     with rettype=gb (GenBank flat file text format).
 *   - The COMMENT section of the GB flat file contains:
 *       a) A boilerplate "REVIEWED REFSEQ:" or "INFERRED REFSEQ:" preamble (omitted)
 *       b) A transcript-variant-specific description paragraph (returned)
 *       c) ##RefSeq-Attributes## structured tags (omitted)
 *   - This data is NOT present in any currently fetched response (gene_table,
 *     nuccore ESummary used by MANE fetch) — it always requires this additional call.
 *
 * Algorithm (1 Entrez call per request):
 *   1. EFetch nuccore rettype=gb for the accession → GenBank flat file text
 *   2. Parse the COMMENT section — extract description paragraph(s)
 *
 * Returns { summary: string } when description text found, { summary: null } otherwise.
 * Errors return { error: string } with HTTP 502.
 *
 * Entrez call count: +1 per expand (EFetch gb) — logged in the Entrez call map
 * in the Phase 5.3B Part 2 final report.
 */

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ACCESSION_RE = /^(NM_|NR_|XM_|XR_)\d+\.\d+$/;

// ── Server-side sequential rate limiter (module-scoped, shared across requests) ──
// Mirrors the pattern in app/api/transcript/download/route.ts.
// Serializes concurrent summary requests so rapid expand events never fire
// overlapping NCBI EFetch calls.
let summaryChain: Promise<void> = Promise.resolve();
let lastSummaryCallAt = 0;

async function withSummaryRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const runPromise = summaryChain.then(async () => {
    const waitMs = lastSummaryCallAt + GENE_RATE_DELAY_MS - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    lastSummaryCallAt = Date.now();
    return task();
  });
  // Keep the chain alive even if this task fails.
  summaryChain = runPromise.then(
    () => undefined,
    () => undefined
  );
  return runPromise;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const accession = (searchParams.get("accession") ?? "").trim();

  if (!ACCESSION_RE.test(accession)) {
    return NextResponse.json(
      { error: "Invalid or missing transcript accession." },
      { status: 400 }
    );
  }

  try {
    // ── EFetch nuccore → GenBank flat file text (rate-limited) ───────────────
    // EFetch accepts accession numbers directly in the id parameter.
    // rettype=gb gives the full GenBank record in text format.
    const efetchUrl =
      `${NCBI_BASE}/efetch.fcgi?db=nuccore` +
      `&id=${encodeURIComponent(accession)}` +
      `&rettype=gb&retmode=text`;

    const gbText = await withSummaryRateLimit(async () => {
      const res = await fetch(efetchUrl, {
        headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
        next: { revalidate: 0 },
      });
      if (!res.ok) {
        if (res.status === 429)
          throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
        throw new Error(`HTTP ${res.status} from NCBI EFetch: ${efetchUrl}`);
      }
      return res.text();
    });

    // ── Parse COMMENT section from GenBank flat file ─────────────────────────
    const summary = parseGbComment(gbText);

    return NextResponse.json({ summary }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "NCBI rate limit hit — please wait a moment and try again."
          : `Failed to fetch transcript summary: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}

/**
 * Extract the transcript-specific description from a GenBank COMMENT section.
 *
 * GenBank COMMENT block structure for RefSeq mRNA records (confirmed live 2026-07-03):
 *
 *   COMMENT     REVIEWED REFSEQ: This record has been curated...   ← skip (preamble)
 *               <blank>
 *               On Feb 13, 2020 this sequence version replaced...   ← skip (version notice)
 *               <blank>
 *               Summary: This gene encodes a tumor suppressor...    ← skip (gene-level; shown above)
 *               <blank>
 *               Transcript Variant: This variant (1) can initiate   ← RETURN THIS
 *               translation from two in-frame AUG start codons...
 *               <blank>
 *               Publication Note: ...                               ← skip
 *               <blank>
 *               ##Evidence-Data-START##                             ← skip
 *               ...
 *               ##RefSeq-Attributes-START##                         ← skip
 *               ...
 *
 * Strategy: look specifically for the "Transcript Variant:" paragraph, which
 * contains transcript-specific biological information. This is distinct from the
 * gene-level "Summary:" paragraph (already displayed in the Gene Explorer card above).
 *
 * If no "Transcript Variant:" paragraph exists (predicted transcripts, non-coding
 * transcripts, or records without variant-specific annotations), return null —
 * the UI will omit the summary section entirely per spec.
 */
function parseGbComment(gbText: string): string | null {
  // Find COMMENT section start
  const commentMatch = /^COMMENT\s+/m.exec(gbText);
  if (!commentMatch) return null;

  // Find FEATURES section (marks the end of COMMENT)
  const featuresMatch = /^FEATURES\s/m.exec(gbText);
  const commentEnd = featuresMatch ? featuresMatch.index : gbText.length;

  // Extract raw COMMENT block
  const commentBlock = gbText.slice(
    commentMatch.index + commentMatch[0].length,
    commentEnd
  );

  // GenBank continuation lines are indented with 12 spaces; normalise them.
  const lines = commentBlock
    .split("\n")
    .map((line) => line.replace(/^ {12}/, ""));

  // Split into paragraphs separated by blank lines
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join(" ").trim());
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0) paragraphs.push(current.join(" ").trim());

  // Look for the transcript-specific "Transcript Variant:" paragraph.
  // Strip the label prefix when returning it.
  for (const para of paragraphs) {
    if (/^Transcript Variant:\s*/i.test(para)) {
      const text = para.replace(/^Transcript Variant:\s*/i, "").trim();
      if (text.length >= 20) return text;
    }
  }

  // No transcript-variant description found — return null.
  // The UI will omit the summary section entirely (per spec: do NOT show empty card).
  return null;
}
