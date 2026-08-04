/**
 * app/api/protein/domains/route.ts — Phase 5.7A
 *
 * POST /api/protein/domains
 * Body: {
 *   accession: string   // RefSeq protein accession (NP_/XP_ versioned, e.g. "NP_000537.3")
 *   geneId:    string   // NCBI Gene ID — for traceability in returned ProteinDomain objects
 *   organism:  string   // Organism scientific name (e.g. "Homo sapiens")
 * }
 *
 * Returns a domain annotation result distinguishing two empty states:
 *   Case A — identifier unresolved/ambiguous:
 *     { status: "empty", resolutionStatus: "unresolved"|"ambiguous", domains: [], ... }
 *     → UI shows "Protein identifier could not be resolved."
 *   Case B — resolved but no domains annotated:
 *     { status: "empty", resolutionStatus: "resolved", domains: [], ... }
 *     → UI shows "No annotated domains available for this protein."
 *   Success:
 *     { status: "success", resolutionStatus: "resolved", domains: ProteinDomain[], ... }
 *
 * Rate limiting:
 *   Two independent services each have their own rate limiters:
 *   - ProteinIdentifierResolver (UniProt): 300ms sequential chain
 *   - ProteinDomainService (InterPro):     400ms sequential chain
 *   These are module-level chains inside identifier-resolver.ts and domain-fetch.ts.
 *   This route does not add an additional layer.
 *
 * Caching:
 *   Both services cache their results. On cache hits, neither makes external calls.
 *
 * Error handling:
 *   HTTP 400: invalid or missing accession/geneId/organism
 *   HTTP 429: UniProt or InterPro rate-limited
 *   HTTP 502: network/upstream failure
 *   HTTP 200: always on success (including empty states — those are not errors)
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveProteinIdentifier } from "@/lib/protein/identifier-resolver";
import { getProteinDomains } from "@/lib/protein/domain-fetch";
import type { ProteinDomain } from "@/types/protein-domain";

// Accepted accession prefixes for db=protein (same as other protein routes).
const PROTEIN_ACCESSION_RE = /^(NP_|XP_)\d+\.\d+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { accession?: unknown; geneId?: unknown; organism?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accession = typeof body?.accession === "string" ? body.accession.trim() : "";
  const geneId = typeof body?.geneId === "string" ? body.geneId.trim() : "";
  const organism = typeof body?.organism === "string" ? body.organism.trim() : "";

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

  const startTime = Date.now();

  try {
    // ── Step 1: Resolve RefSeq → UniProt ─────────────────────────────────────
    const mapping = await resolveProteinIdentifier(accession);

    // ── Case A: identifier could not be resolved ──────────────────────────────
    if (mapping.resolutionStatus !== "resolved") {
      return NextResponse.json(
        {
          status: "empty",
          resolutionStatus: mapping.resolutionStatus,
          domains: [] as ProteinDomain[],
          count: 0,
          cached: false,
          executionTimeMs: Date.now() - startTime,
        },
        { status: 200 }
      );
    }

    // ── Step 2: Fetch domains from InterPro ───────────────────────────────────
    const domains = await getProteinDomains(mapping, geneId, organism);

    // ── Case B: resolved but no domains annotated ────────────────────────────
    if (domains.length === 0) {
      return NextResponse.json(
        {
          status: "empty",
          resolutionStatus: "resolved",
          uniprotAccession: mapping.uniprotAccession,
          domains: [] as ProteinDomain[],
          count: 0,
          cached: false,
          executionTimeMs: Date.now() - startTime,
        },
        { status: 200 }
      );
    }

    // ── Success ───────────────────────────────────────────────────────────────
    return NextResponse.json(
      {
        status: "success",
        resolutionStatus: "resolved",
        uniprotAccession: mapping.uniprotAccession,
        domains,
        count: domains.length,
        cached: false,
        executionTimeMs: Date.now() - startTime,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "Rate limit hit — please wait a moment and try again."
          : `Protein domain retrieval failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}
