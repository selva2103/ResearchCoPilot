/**
 * app/api/protein/structure/route.ts — Phase 5.8A
 *
 * POST /api/protein/structure
 * Body: {
 *   accession: string   // RefSeq protein accession (NP_/XP_ versioned, e.g. "NP_000537.3")
 *   geneId:    string   // NCBI Gene ID — for traceability in returned ProteinStructure objects
 *   organism:  string   // Organism scientific name (e.g. "Homo sapiens")
 * }
 *
 * Returns a StructureResolutionResult (types/protein-structure.ts) preserving
 * every per-source distinction (Section 6):
 *   identifierStatus        "resolved" | "unresolved"
 *   structureAvailability   "available" | "none" | "partial-source-failure" | "source-failure"
 *   sourceStatuses          { alphafold, pdb } each "not-attempted"|"success"|"empty"|"error"
 *   structures              normalized ProteinStructure[] (PDB ranked per Section 3)
 *
 * Independent failure model: a failure in one source never suppresses the
 * other's successful result. Both sources return independently.

 * Only normalized records are exposed — no raw upstream payloads, no
 * credentials, no cache internals.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveProteinIdentifier } from "@/lib/protein/identifier-resolver";
import {
  getProteinStructureResult,
  isAlphaFoldStructureCached,
  isPdbStructureCached,
} from "@/lib/protein/structure-fetch";

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
    // ── Step 1: Resolve RefSeq → UniProt (existing resolver) ─────────────────
    const mapping = await resolveProteinIdentifier(accession);

    // ── Step 2: Independent per-source structure retrieval ────────────────────
    // Cache state must be read BEFORE the fetch (the fetch populates the cache).
    const wasCached =
      mapping.resolutionStatus === "resolved" &&
      isAlphaFoldStructureCached(mapping.refseqAccession) &&
      isPdbStructureCached(mapping.refseqAccession);
    const result = await getProteinStructureResult(mapping, geneId, organism);

    return NextResponse.json(
      {
        ...result,
        cached: wasCached,
        executionTimeMs: Date.now() - startTime,
      },
      { status: 200 }
    );
  } catch (err) {
    // Only reached if identifier resolution itself throws (network/timeout) —
    // per-source structure failures are captured inside getProteinStructureResult
    // and surfaced in sourceStatuses, not as an HTTP error.
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited =
      message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json(
      {
        error: isRateLimited
          ? "Rate limit hit — please wait a moment and try again."
          : `Protein structure retrieval failed: ${message}`,
        rateLimited: isRateLimited,
      },
      { status: isRateLimited ? 429 : 502 }
    );
  }
}