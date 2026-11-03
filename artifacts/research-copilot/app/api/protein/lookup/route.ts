/**
 * app/api/protein/lookup - direct UniProt accession / PDB ID lookup
 *
 * POST { id: string }
 *
 * The id must look like a UniProt accession or a PDB ID (the two shapes cannot
 * overlap: UniProt starts with a letter, PDB with a digit). The record is fetched
 * directly from UniProt (rest.uniprot.org) or RCSB (data.rcsb.org); nothing is
 * inferred or invented. Fields that the source does not return stay null.
 *
 * Response (HTTP 200): { kind, status: "found", ...fields } or { kind, status: "not-found" }
 * Errors: 400 not an ID / bad body, 429 upstream rate limit, 502 network/upstream/timeout.
 * Results (found and not-found) are cached in memory for 24 h.
 */

import { NextRequest, NextResponse } from "next/server";

const UNIPROT_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;
const PDB_RE = /^[1-9][A-Z0-9]{3}$/;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FUNCTION_CHARS = 600;

interface UniProtJson {
  primaryAccession?: string;
  uniProtkbId?: string;
  entryType?: string;
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: Array<{ fullName?: { value?: string } }>;
  };
  genes?: Array<{ geneName?: { value?: string } }>;
  organism?: { scientificName?: string; taxonId?: number };
  sequence?: { length?: number };
  comments?: Array<{ commentType?: string; texts?: Array<{ value?: string }> }>;
}

interface RcsbJson {
  struct?: { title?: string };
  exptl?: Array<{ method?: string }>;
  rcsb_entry_info?: { resolution_combined?: number[] };
  rcsb_accession_info?: { initial_release_date?: string };
}

type LookupBody =
  | {
      kind: "uniprot";
      status: "found";
      accession: string;
      entryName: string | null;
      reviewed: boolean | null;
      name: string | null;
      gene: string | null;
      organism: string | null;
      taxId: number | null;
      length: number | null;
      functionText: string | null;
      links: { entry: string; fasta: string };
    }
  | {
      kind: "pdb";
      status: "found";
      id: string;
      title: string | null;
      method: string | null;
      resolution: number | null;
      releaseDate: string | null;
      links: { entry: string; view3d: string; cif: string; pdb: string };
    }
  | { kind: "uniprot" | "pdb"; status: "not-found" };

class UpstreamError extends Error {
  constructor(public upstreamStatus: number) {
    super(`HTTP ${upstreamStatus} from upstream`);
  }
}

const cache = new Map<string, { at: number; body: LookupBody }>();

async function fetchJson(url: string): Promise<{ missing: boolean; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 400 || res.status === 410) {
      return { missing: true, json: null };
    }
    if (!res.ok) throw new UpstreamError(res.status);
    return { missing: false, json: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

function reviewedFlag(entryType: string | undefined): boolean | null {
  if (!entryType) return null;
  const s = entryType.toLowerCase();
  if (s.includes("unreviewed")) return false;
  if (s.includes("reviewed")) return true;
  return null;
}

async function lookupUniProt(acc: string): Promise<LookupBody> {
  const { missing, json } = await fetchJson(`https://rest.uniprot.org/uniprotkb/${acc}.json`);
  if (missing || !json) return { kind: "uniprot", status: "not-found" };
  const rec = json as UniProtJson;
  const accession = rec.primaryAccession ?? acc;
  const pd = rec.proteinDescription;
  const fn = rec.comments?.find((c) => c.commentType === "FUNCTION")?.texts?.[0]?.value ?? null;
  return {
    kind: "uniprot",
    status: "found",
    accession,
    entryName: rec.uniProtkbId ?? null,
    reviewed: reviewedFlag(rec.entryType),
    name: pd?.recommendedName?.fullName?.value ?? pd?.submissionNames?.[0]?.fullName?.value ?? null,
    gene: rec.genes?.[0]?.geneName?.value ?? null,
    organism: rec.organism?.scientificName ?? null,
    taxId: typeof rec.organism?.taxonId === "number" ? rec.organism.taxonId : null,
    length: typeof rec.sequence?.length === "number" ? rec.sequence.length : null,
    functionText: fn && fn.length > MAX_FUNCTION_CHARS ? fn.slice(0, MAX_FUNCTION_CHARS).trimEnd() + "..." : fn,
    links: {
      entry: `https://www.uniprot.org/uniprotkb/${accession}/entry`,
      fasta: `https://rest.uniprot.org/uniprotkb/${accession}.fasta`,
    },
  };
}

async function lookupPdb(id: string): Promise<LookupBody> {
  const { missing, json } = await fetchJson(`https://data.rcsb.org/rest/v1/core/entry/${id}`);
  if (missing || !json) return { kind: "pdb", status: "not-found" };
  const rec = json as RcsbJson;
  const res = rec.rcsb_entry_info?.resolution_combined?.[0];
  return {
    kind: "pdb",
    status: "found",
    id,
    title: rec.struct?.title ?? null,
    method: rec.exptl?.[0]?.method ?? null,
    resolution: typeof res === "number" ? res : null,
    releaseDate: rec.rcsb_accession_info?.initial_release_date ?? null,
    links: {
      entry: `https://www.rcsb.org/structure/${id}`,
      view3d: `https://www.rcsb.org/3d-view/${id}`,
      cif: `/api/protein/structure/download?db=pdb&id=${id}&format=cif`,
      pdb: `/api/protein/structure/download?db=pdb&id=${id}&format=pdb`,
    },
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body as { id?: unknown } | null)?.id;
  if (typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "Missing id in request body." }, { status: 400 });
  }
  const id = raw.trim().toUpperCase();
  const kind = UNIPROT_RE.test(id) ? "uniprot" : PDB_RE.test(id) ? "pdb" : null;
  if (!kind) {
    return NextResponse.json({ error: "Not a UniProt accession or PDB ID." }, { status: 400 });
  }

  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.body);

  try {
    const result = kind === "uniprot" ? await lookupUniProt(id) : await lookupPdb(id);
    cache.set(key, { at: Date.now(), body: result });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UpstreamError && err.upstreamStatus === 429) {
      return NextResponse.json({ error: "Upstream rate limit. Try again shortly." }, { status: 429 });
    }
    return NextResponse.json({ error: "Lookup source unavailable." }, { status: 502 });
  }
}
