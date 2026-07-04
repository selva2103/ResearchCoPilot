/**
 * lib/resolver/gene.ts — NCBI Gene Resolution (Step 7)
 *
 * Detection rule (Step 2):
 *   A query is attempted as a Gene if it matches GENE_SYMBOL_RE
 *   (/^[A-Z][A-Z0-9]{1,12}$/) AND NCBI Gene ESearch confirms an
 *   exact symbol match (name == query, case-insensitive).
 *
 * Resolution strategy:
 *   0. Organism-prefix path (new — FIX 2): when detectedOrganism is provided
 *      by the caller (from lib/resolver/organism-prefix.ts pre-step):
 *      → ESearch {q}[sym] AND {taxId}[Taxonomy ID]
 *      → HIGH confidence (0.92) if a matching result is found
 *      → Falls through to steps 1/2 if no organism-specific result
 *   1. ESearch db=gene, term="{query}[sym] AND Homo sapiens[orgn]"
 *      → confirmed human gene → HIGH confidence (0.92)
 *      (Skipped when detectedOrganism is a non-human organism)
 *   2. If no human hit: ESearch without organism filter
 *      a. Single organism result → MEDIUM confidence (0.85)
 *      b. Multiple organisms → MEDIUM confidence (0.80), ambiguityDetected=true
 *   3. No results → return null (resolver falls through to Organism / Disease)
 *
 * Scope: returns gene metadata only. Does NOT retrieve transcripts, proteins,
 * or sequences — those belong to Phase 5.2+.
 *
 * Databases: NCBI Gene (ESearch + ESummary)
 */

import {
  NCBI_BASE,
  RESOLVER_RATE_DELAY_MS,
  sleep,
  resolverFetch,
} from "@/lib/resolver/fetch";
import type { QueryResolution, CandidateMatch } from "@/types/query-resolution";
import { toConfidenceTier } from "@/types/query-resolution";

// ── Gene symbol pattern (mirrors lib/genbank/search.ts GENE_SYMBOL_RE) ────────
// All-uppercase letters and digits, 2–13 characters, starting with a letter.
// Excludes hyphens, spaces, underscores — prevents false positives on
// organism names ("SARS-CoV-2") or disease names ("Leukemia").
const GENE_SYMBOL_RE = /^[A-Z][A-Z0-9]{1,12}$/;

// ── NCBI raw response shapes ──────────────────────────────────────────────────

interface GeneESearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
  };
}

interface GeneESummaryEntry {
  uid: string;
  name: string;            // official gene symbol
  description: string;     // full gene name
  status: string;
  chromosome: string;
  maplocation: string;
  organism: {
    scientificname: string;
    taxid: number;
  };
  otheraliases?: string;   // comma-separated list of synonyms / aliases
  summary?: string;
}

interface GeneESummaryResult {
  result: { uids: string[] } & Record<string, GeneESummaryEntry>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function geneESearch(term: string): Promise<{ count: number; ids: string[] }> {
  const url =
    `${NCBI_BASE}/esearch.fcgi?db=gene` +
    `&term=${encodeURIComponent(term)}&retmax=5&retmode=json`;
  const data = (await resolverFetch(url)) as GeneESearchResult;
  const count = parseInt(data.esearchresult.count, 10) || 0;
  return { count, ids: data.esearchresult.idlist ?? [] };
}

async function geneESummary(ids: string[]): Promise<GeneESummaryEntry[]> {
  if (ids.length === 0) return [];
  const url =
    `${NCBI_BASE}/esummary.fcgi?db=gene` +
    `&id=${ids.slice(0, 5).join(",")}&retmode=json`;
  const data = (await resolverFetch(url)) as GeneESummaryResult;
  const uids = data.result.uids ?? [];
  return uids
    .map((uid) => data.result[uid])
    .filter((e): e is GeneESummaryEntry => Boolean(e) && e.status !== "discontinued");
}

function exactSymbolMatch(entry: GeneESummaryEntry, query: string): boolean {
  return entry.name.toUpperCase() === query.toUpperCase();
}

function buildAliases(entry: GeneESummaryEntry): string[] {
  return entry.otheraliases
    ? entry.otheraliases.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Attempt to resolve the query as a gene symbol.
 *
 * Returns null if the query does not match GENE_SYMBOL_RE or if NCBI Gene
 * returns no matching results. The caller falls through to organism/disease.
 *
 * @param query            Gene symbol to search (may be mixed-case when
 *                         detectedOrganism is supplied from the pre-step).
 * @param detectedOrganism When set (from lib/resolver/organism-prefix.ts pre-step),
 *                         search this organism first via taxId-filtered ESearch
 *                         (FIX 2 — Organism-Aware Gene Ranking Patch).
 *                         Also bypasses the uppercase-only GENE_SYMBOL_RE guard so
 *                         mixed-case symbols like "Trp53" or "Sox2" are accepted.
 */
export async function resolveGene(
  query: string,
  detectedOrganism?: { taxId: number; name: string }
): Promise<Omit<QueryResolution, "originalQuery"> | null> {
  // When called from the organism-prefix pre-step, bypass the uppercase-only
  // symbol guard — non-human gene symbols are often mixed-case (Trp53, Sox2).
  // When called from the normal pipeline, the uppercase-only guard still applies.
  if (!detectedOrganism && !GENE_SYMBOL_RE.test(query.trim())) return null;

  const q = query.trim().toUpperCase();

  // ── Step 0: Organism-specific path (FIX 2) ────────────────────────────────
  // Only runs when the caller detected an organism prefix (e.g. "mouse CD4").
  // Uses NCBI's documented taxId filter: {symbol}[sym] AND {taxId}[Taxonomy ID]
  // (verified 2026-07-03: both CD4[sym] AND 10090[Taxonomy ID] and Mus musculus[orgn]
  // return Gene ID 12504 — taxId form preferred as it is exact and language-independent).
  if (detectedOrganism) {
    const { count: orgCount, ids: orgIds } = await geneESearch(
      `${q}[sym] AND ${detectedOrganism.taxId}[Taxonomy ID]`
    );

    if (orgCount > 0 && orgIds.length > 0) {
      await sleep(RESOLVER_RATE_DELAY_MS);
      const entries = await geneESummary(orgIds);

      // Prefer exact symbol match; fall back to first result from the correct organism
      const exact = entries.find((e) => exactSymbolMatch(e, q));
      const orgMatch = entries.find(
        (e) => e.organism.taxid === detectedOrganism.taxId
      );
      const best = exact ?? orgMatch ?? entries[0];

      if (best) {
        const aliases = buildAliases(best);
        return {
          normalizedQuery: best.name,
          queryType: "Gene",
          confidence: 0.92, // HIGH — both organism and gene symbol confirmed
          confidenceTier: toConfidenceTier(0.92),
          matchedProvider: "ncbi-gene",
          primaryIdentifier: best.uid,
          identifierScheme: "ncbi-gene",
          scientificName: best.description,
          organism: best.organism.scientificname,
          taxonomyId: String(best.organism.taxid),
          synonyms: aliases,
          synonymSource: aliases.length > 0 ? "ncbi-gene" : undefined,
          relationships: {
            organisms: [best.organism.scientificname],
          },
          resolutionPath: "ncbi-gene-organism-prefix",
          ambiguityDetected: false,
          selectedMatch: {
            identifier: best.uid,
            displayName: best.name,
            organism: best.organism.scientificname,
            queryType: "Gene",
            confidence: 0.92,
          },
        };
      }
    }

    // Organism-filtered search found nothing.
    // Return null so the caller (resolver/index.ts pre-step) falls through to the
    // normal synonym-normalization + gene + organism + disease pipeline.
    // Do NOT fall back to a broad cross-organism search here — that would resolve a
    // species-qualified query (e.g. "mouse XYZ") to the wrong organism's gene.
    return null;
  }

  // ── Step 1: Search in Homo sapiens (most common intent) ─────────────────
  const { count: humanCount, ids: humanIds } = await geneESearch(
    `${q}[sym] AND Homo sapiens[orgn]`
  );

  if (humanCount > 0 && humanIds.length > 0) {
    await sleep(RESOLVER_RATE_DELAY_MS);
    const entries = await geneESummary(humanIds);
    const exact = entries.find((e) => exactSymbolMatch(e, q));
    const best = exact ?? entries[0];

    if (best) {
      const aliases = buildAliases(best);
      return {
        normalizedQuery: best.name,
        queryType: "Gene",
        confidence: 0.92,
        confidenceTier: toConfidenceTier(0.92),
        matchedProvider: "ncbi-gene",
        primaryIdentifier: best.uid,
        identifierScheme: "ncbi-gene",
        scientificName: best.description,
        organism: best.organism.scientificname,
        taxonomyId: String(best.organism.taxid),
        synonyms: aliases,
        synonymSource: aliases.length > 0 ? "ncbi-gene" : undefined,
        relationships: {
          organisms: [best.organism.scientificname],
        },
        resolutionPath: "ncbi-gene-exact-human",
        ambiguityDetected: entries.length > 1,
        candidateMatches:
          entries.length > 1
            ? entries.map(
                (e): CandidateMatch => ({
                  identifier: e.uid,
                  displayName: e.name,
                  organism: e.organism.scientificname,
                  queryType: "Gene",
                  confidence: exactSymbolMatch(e, q) ? 0.92 : 0.78,
                })
              )
            : undefined,
        selectedMatch: {
          identifier: best.uid,
          displayName: best.name,
          organism: best.organism.scientificname,
          queryType: "Gene",
          confidence: 0.92,
        },
      };
    }
  }

  // ── Step 2: Search without organism filter (non-human genes) ─────────────
  await sleep(RESOLVER_RATE_DELAY_MS);
  const { count: anyCount, ids: anyIds } = await geneESearch(`${q}[sym]`);

  if (anyCount === 0 || anyIds.length === 0) return null;

  await sleep(RESOLVER_RATE_DELAY_MS);
  const anyEntries = await geneESummary(anyIds);
  if (anyEntries.length === 0) return null;

  const exactEntries = anyEntries.filter((e) => exactSymbolMatch(e, q));
  const results = exactEntries.length > 0 ? exactEntries : anyEntries;

  const isAmbiguous = results.length > 1;
  const confidence = isAmbiguous ? 0.80 : 0.85;
  const best = results[0];

  const aliases = buildAliases(best);

  return {
    normalizedQuery: best.name,
    queryType: "Gene",
    confidence,
    confidenceTier: toConfidenceTier(confidence),
    matchedProvider: "ncbi-gene",
    primaryIdentifier: best.uid,
    identifierScheme: "ncbi-gene",
    scientificName: best.description,
    organism: best.organism.scientificname,
    taxonomyId: String(best.organism.taxid),
    synonyms: aliases,
    synonymSource: aliases.length > 0 ? "ncbi-gene" : undefined,
    relationships: {
      organisms: results.map((e) => e.organism.scientificname),
    },
    resolutionPath: isAmbiguous
      ? "ncbi-gene-ambiguous"
      : "ncbi-gene-exact-nonhuman",
    ambiguityDetected: isAmbiguous,
    candidateMatches: isAmbiguous
      ? results.map(
          (e): CandidateMatch => ({
            identifier: e.uid,
            displayName: `${e.name} (${e.organism.scientificname})`,
            organism: e.organism.scientificname,
            queryType: "Gene",
            confidence: exactSymbolMatch(e, q) ? 0.80 : 0.70,
          })
        )
      : undefined,
    selectedMatch: isAmbiguous
      ? undefined
      : {
          identifier: best.uid,
          displayName: best.name,
          organism: best.organism.scientificname,
          queryType: "Gene",
          confidence: 0.85,
        },
    notes: isAmbiguous
      ? `Gene symbol "${q}" found in ${results.length} organisms. Ambiguity unresolved — user should specify organism.`
      : `Gene symbol "${q}" found in ${best.organism.scientificname} only (non-human).`,
  };
}
