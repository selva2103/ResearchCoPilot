/**
 * lib/resolver/organism.ts — NCBI Taxonomy Resolution (Steps 8 / Organism)
 *
 * Detection rule (Step 2):
 *   Organism is confirmed by NCBI Taxonomy ESearch returning an exact or
 *   best-ranked match for the query string.
 *   - Scientific name match (case-insensitive exact): confidence 0.92 (HIGH)
 *   - Common name match (case-insensitive exact):     confidence 0.92 (HIGH)
 *   - First result, no exact name match:              confidence 0.80 (MEDIUM)
 *
 * Scope: returns taxonomy metadata only — scientific name, TaxID, division,
 * and any common names / synonyms from the "othernames" field.
 * Does NOT retrieve genomes, sequences, or assemblies — those are handled
 * by Sequence Foundation (Phase 5.1).
 *
 * Databases: NCBI Taxonomy (ESearch + ESummary)
 */

import {
  NCBI_BASE,
  RESOLVER_RATE_DELAY_MS,
  sleep,
  resolverFetch,
} from "@/lib/resolver/fetch";
import type { QueryResolution } from "@/types/query-resolution";
import { toConfidenceTier } from "@/types/query-resolution";

// ── Raw NCBI response shapes ──────────────────────────────────────────────────

interface TaxESearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
  };
}

interface TaxOtherNames {
  synonym?: string | string[];
  commonname?: string | string[];
  genbank_synonym?: string | string[];
  equivalent_name?: string | string[];
  includes?: string | string[];
}

interface TaxESummaryEntry {
  uid: string;
  taxid: number;
  scientificname: string;
  commonname?: string;
  rank: string;
  division: string;
  status: string;
  parenttaxid: number;
  othernames?: TaxOtherNames;
}

interface TaxESummaryResult {
  result: { uids: string[] } & Record<string, TaxESummaryEntry>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenNames(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function collectTaxSynonyms(entry: TaxESummaryEntry): string[] {
  if (!entry.othernames) return [];
  const on = entry.othernames;
  return [
    ...flattenNames(on.synonym),
    ...flattenNames(on.commonname),
    ...flattenNames(on.genbank_synonym),
    ...flattenNames(on.equivalent_name),
  ].filter(Boolean);
}

/** Case-insensitive exact match against scientific name or any known common name. */
function exactTaxMatch(entry: TaxESummaryEntry, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (entry.scientificname.toLowerCase() === q) return true;
  if (entry.commonname?.toLowerCase() === q) return true;
  const syns = collectTaxSynonyms(entry);
  return syns.some((s) => s.toLowerCase() === q);
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Attempt to resolve the query as an NCBI Taxonomy organism.
 *
 * Returns null when ESearch finds no results (resolver falls through to Disease).
 */
export async function resolveOrganism(
  query: string
): Promise<Omit<QueryResolution, "originalQuery"> | null> {
  const q = query.trim();

  // ESearch — retmax=3 to detect ambiguity without over-fetching
  const searchUrl =
    `${NCBI_BASE}/esearch.fcgi?db=taxonomy` +
    `&term=${encodeURIComponent(q)}&retmax=3&retmode=json`;
  const searchData = (await resolverFetch(searchUrl)) as TaxESearchResult;
  const count = parseInt(searchData.esearchresult.count, 10) || 0;
  const ids = searchData.esearchresult.idlist ?? [];

  if (count === 0 || ids.length === 0) return null;

  await sleep(RESOLVER_RATE_DELAY_MS);

  // ESummary — fetch the top result (and up to 2 more for disambiguation)
  const summaryUrl =
    `${NCBI_BASE}/esummary.fcgi?db=taxonomy` +
    `&id=${ids.join(",")}&retmode=json`;
  const summaryData = (await resolverFetch(summaryUrl)) as TaxESummaryResult;
  const uids = summaryData.result.uids ?? [];
  const entries = uids
    .map((uid) => summaryData.result[uid])
    .filter((e): e is TaxESummaryEntry => Boolean(e) && e.status !== "deleted");

  if (entries.length === 0) return null;

  // Prefer an entry that exactly matches the query (scientific or common name)
  const exactEntry = entries.find((e) => exactTaxMatch(e, q));
  const best = exactEntry ?? entries[0];

  const isExact = exactTaxMatch(best, q);
  const confidence = isExact ? 0.92 : 0.80;

  const synonyms = collectTaxSynonyms(best);
  if (best.commonname && !synonyms.includes(best.commonname)) {
    synonyms.unshift(best.commonname);
  }

  // Use scientific name as the canonical normalized query for downstream modules
  const normalizedQuery = best.scientificname;

  return {
    normalizedQuery,
    queryType: "Organism",
    confidence,
    confidenceTier: toConfidenceTier(confidence),
    matchedProvider: "ncbi-taxonomy",
    primaryIdentifier: String(best.taxid),
    identifierScheme: "ncbi-taxonomy",
    scientificName: best.scientificname,
    organism: best.commonname ?? best.scientificname,
    taxonomyId: String(best.taxid),
    synonyms: synonyms.length > 0 ? synonyms : undefined,
    synonymSource: synonyms.length > 0 ? "ncbi-taxonomy" : undefined,
    relationships: {
      organisms: [best.scientificname],
    },
    resolutionPath: isExact
      ? "ncbi-taxonomy-exact"
      : "ncbi-taxonomy-partial",
    notes: isExact
      ? undefined
      : `Top taxonomy result (TaxID ${best.taxid}) does not exactly match "${q}" — may be a partial or related match.`,
  };
}
