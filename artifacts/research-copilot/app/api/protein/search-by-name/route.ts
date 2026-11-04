/**
 * app/api/protein/search-by-name - Phase R Problem D
 *
 * POST { query: string }
 *
 * Fallback protein search for unresolved queries. Searches UniProt reviewed
 * (Swiss-Prot) entries by protein name or gene name, human (taxid 9606) first;
 * only if there are zero human hits does it broaden to all reviewed organisms.
 * Never auto-resolves: always returns candidates for the user to review.
 *
 * Response: { candidates, count, total, searchedHumanOnly, skipped? }
 *   total: UniProt's total hit count (x-total-results header), null if absent
 *   skipped: set when the query was too long to be a protein name
 *
 * The query is sanitized (quotes/backslashes/control chars removed) and sent
 * as a quoted phrase, so user text cannot inject UniProt query syntax.
 *
 * Errors: 400 missing query, 429 UniProt rate limit, 502 network/upstream/timeout.
 * Zero results is HTTP 200, not an error.
 */

import { NextRequest, NextResponse } from "next/server";

const UNIPROT_SEARCH_URL = "https://rest.uniprot.org/uniprotkb/search";
const RESULT_SIZE = 10;
const MAX_QUERY_CHARS = 80;
const MAX_QUERY_WORDS = 6;
const FETCH_TIMEOUT_MS = 10_000;

interface UniProtSearchEntry {
  primaryAccession: string;
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: Array<{ fullName?: { value?: string } }>;
  };
  genes?: Array<{ geneName?: { value?: string } }>;
  organism?: { scientificName?: string };
}

interface UniProtSearchResponse {
  results?: UniProtSearchEntry[];
}

interface UniProtSearchResult {
  entries: UniProtSearchEntry[];
  total: number | null;
}

export interface ProteinNameSearchCandidate {
  accession: string;
  name: string | null;
  gene: string | null;
  organism: string;
}

function sanitizeQuery(raw: string): string {
  return raw.replace(/[\u0000-\u001f"\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function searchUniProt(query: string, humanOnly: boolean): Promise<UniProtSearchResult> {
  const nameClause = `(protein_name:"${query}" OR gene:"${query}") AND reviewed:true`;
  const q = humanOnly ? `${nameClause} AND organism_id:9606` : nameClause;
  const url =
    `${UNIPROT_SEARCH_URL}?query=${encodeURIComponent(q)}` +
    `&fields=accession,id,protein_name,gene_names,organism_name&format=json&size=${RESULT_SIZE}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 - UniProt search rate limit hit");
    throw new Error(`UniProt search HTTP ${res.status}`);
  }
  const header = res.headers.get("x-total-results");
  const parsed = header === null ? NaN : Number.parseInt(header, 10);
  const json = (await res.json()) as UniProtSearchResponse;
  return { entries: json.results ?? [], total: Number.isNaN(parsed) ? null : parsed };
}

function toCandidate(entry: UniProtSearchEntry): ProteinNameSearchCandidate {
  return {
    accession: entry.primaryAccession,
    name:
      entry.proteinDescription?.recommendedName?.fullName?.value ??
      entry.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
      null,
    gene: entry.genes?.[0]?.geneName?.value ?? null,
    organism: entry.organism?.scientificName ?? "Unknown organism",
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { query?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = sanitizeQuery(typeof body?.query === "string" ? body.query : "");
  if (!query) {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }
  if (query.length > MAX_QUERY_CHARS || query.split(" ").length > MAX_QUERY_WORDS) {
    return NextResponse.json(
      { candidates: [], count: 0, total: 0, searchedHumanOnly: true, skipped: "query_too_long" },
      { status: 200 }
    );
  }

  try {
    let result = await searchUniProt(query, true);
    let searchedHumanOnly = true;

    if (result.entries.length === 0) {
      result = await searchUniProt(query, false);
      searchedHumanOnly = false;
    }

    const candidates = result.entries.map(toCandidate);

    return NextResponse.json(
      { candidates, count: candidates.length, total: result.total, searchedHumanOnly },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimited = message.includes("429") || message.toLowerCase().includes("rate limit");
    return NextResponse.json({ error: message }, { status: isRateLimited ? 429 : 502 });
  }
}
