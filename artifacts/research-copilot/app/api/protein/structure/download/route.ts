/**
 * GET /api/protein/structure/download?db=pdb|alphafold&id=...&format=...[&version=N]
 * Builds the upstream URL from an allowlisted template (never a passthrough) and
 * streams the file with Content-Disposition: attachment.
 */
import { NextRequest, NextResponse } from "next/server";

const PDB_FORMATS: Record<string, (id: string) => string> = {
  "cif": (id) => `https://files.rcsb.org/download/${id}.cif`,
  "pdb": (id) => `https://files.rcsb.org/download/${id}.pdb`,
  "cif.gz": (id) => `https://files.rcsb.org/download/${id}.cif.gz`,
  "pdb.gz": (id) => `https://files.rcsb.org/download/${id}.pdb.gz`,
  "bcif": (id) => `https://models.rcsb.org/${id}.bcif`,
};
const AF_FORMATS: Record<string, (id: string, v: string) => string> = {
  "cif": (id, v) => `https://alphafold.ebi.ac.uk/files/${id}-model_v${v}.cif`,
  "pdb": (id, v) => `https://alphafold.ebi.ac.uk/files/${id}-model_v${v}.pdb`,
  "bcif": (id, v) => `https://alphafold.ebi.ac.uk/files/${id}-model_v${v}.bcif`,
};

export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const p = req.nextUrl.searchParams;
  const db = p.get("db") ?? "";
  const id = p.get("id") ?? "";
  const format = p.get("format") ?? "";
  const version = p.get("version") ?? "";

  let upstream: string | null = null;
  let filename = "";
  if (db === "pdb" && /^[A-Za-z0-9]{4}$/.test(id) && PDB_FORMATS[format]) {
    upstream = PDB_FORMATS[format](id.toUpperCase());
    filename = `${id.toUpperCase()}.${format}`;
  } else if (db === "alphafold" && /^AF-[A-Za-z0-9-]+-F\d+$/.test(id) && /^\d{1,3}$/.test(version) && AF_FORMATS[format]) {
    upstream = AF_FORMATS[format](id, version);
    filename = `${id}-model_v${version}.${format}`;
  }
  if (!upstream) {
    return NextResponse.json({ error: "Unsupported or invalid download request." }, { status: 400 });
  }

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "ResearchCoPilot/1.0" } });
    if (res.status === 404) {
      return NextResponse.json({ error: `The ${format} format is not available for this entry.` }, { status: 404 });
    }
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Upstream returned HTTP ${res.status}.` }, { status: 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Download failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
