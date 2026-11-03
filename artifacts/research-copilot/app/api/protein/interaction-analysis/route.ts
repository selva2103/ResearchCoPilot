/**
 * app/api/protein/interaction-analysis/route.ts
 *
 * POST { stringIds: string[2..12], taxonomyId: string|number, minScore?: 0-1000 (default 700) }
 * Returns InteractionAnalysisResult plus executionTimeMs. STRING failures are reported
 * inside the result (sourceStatus), not as HTTP errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { getInteractionAnalysis } from "@/lib/protein/interaction-analysis";

const STRING_ID_RE = /^(\d{1,9})\.[A-Za-z0-9_.\-]{1,60}$/;
const MIN_IDS = 2;
const MAX_IDS = 12;
const DEFAULT_MIN_SCORE = 700;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { stringIds?: unknown; taxonomyId?: unknown; minScore?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taxRaw =
    typeof body?.taxonomyId === "number"
      ? String(body.taxonomyId)
      : typeof body?.taxonomyId === "string"
        ? body.taxonomyId.trim()
        : "";
  if (!/^\d{1,9}$/.test(taxRaw)) {
    return NextResponse.json({ error: "Invalid or missing taxonomyId." }, { status: 400 });
  }
  const taxonId = parseInt(taxRaw, 10);

  const raw = body?.stringIds;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "stringIds must be an array of strings." }, { status: 400 });
  }
  const ids = Array.from(new Set((raw as string[]).map((s) => s.trim())));
  if (ids.length < MIN_IDS || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Provide ${MIN_IDS} to ${MAX_IDS} distinct STRING IDs.` }, { status: 400 });
  }
  for (const id of ids) {
    const m = STRING_ID_RE.exec(id);
    if (!m || parseInt(m[1], 10) !== taxonId) {
      return NextResponse.json({ error: "Each STRING ID must look like <taxonId>.<id> and match taxonomyId." }, { status: 400 });
    }
  }

  let minScore = DEFAULT_MIN_SCORE;
  if (body.minScore !== undefined) {
    if (typeof body.minScore !== "number" || !Number.isInteger(body.minScore) || body.minScore < 0 || body.minScore > 1000) {
      return NextResponse.json({ error: "minScore must be an integer between 0 and 1000." }, { status: 400 });
    }
    minScore = body.minScore;
  }

  const startedAt = Date.now();
  try {
    const result = await getInteractionAnalysis(ids, taxonId, minScore);
    return NextResponse.json({ ...result, executionTimeMs: Date.now() - startedAt }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Interaction analysis failed: ${message}` }, { status: 502 });
  }
}
