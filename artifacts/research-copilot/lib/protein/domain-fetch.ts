/**
 * lib/protein/domain-fetch.ts — Phase 5.7A
 *
 * ProteinDomainService — InterPro REST API client
 * ─────────────────────────────────────────────────
 * Retrieves protein domain annotations from the InterPro REST API.
 * Consumes a resolved UniProt accession from ProteinIdentifierResolver —
 * NEVER calls the UniProt mapping API itself; that separation is enforced
 * by requiring a ProteinIdentifierMapping as input, not a raw accession.
 *
 * SOURCE DECISION (Step 1, Phase 5.7A):
 *   Source: InterPro REST API (`/entry/all/protein/uniprot/{uniprotAccession}/`)
 *   Reason: Aggregates Pfam, PROSITE, PANTHER, PRINTS, CATH, SSF, CDD and
 *           others under one canonical accession system. Returns exact residue
 *           boundaries for every entry. 22 entries for TP53, 27 for BRCA1,
 *           all fit on one page (page_size=200) for tested proteins.
 *   Evidence: PHASE-5.7A-AUDIT-FINDINGS.md
 *
 * NEW EXTERNAL HOST:
 *   www.ebi.ac.uk — independent from NCBI (lib/gene/search.ts), Reactome
 *   (pathway-fetch.ts), and UniProt mapping (identifier-resolver.ts). Own
 *   rate limiter (sequential promise chain, 400ms between requests). Own
 *   cache namespace: proteindomain:{proteinAccession} (keyed by RefSeq, not
 *   UniProt — consistent with the project's canonical identifier discipline).
 *
 * CACHE:
 *   Key: proteindomain:{proteinAccession} (RefSeq accession, e.g. "NP_000537.3")
 *   TTL: 24 hours (same policy as go-fetch.ts, pathway-fetch.ts,
 *        identifier-resolver.ts)
 *
 * PAGINATION:
 *   page_size=200. If `next` URL is present in the response, all pages are
 *   fetched before normalization. Observed: TP53 (22 entries) and BRCA1
 *   (27 entries) both fit on one page; multi-page path is implemented but
 *   has not been needed for tested proteins.
 *
 * DEDUPLICATION:
 *   No deduplication — distinct signatures from different member databases
 *   are biologically valid even when position ranges overlap. Only entries
 *   with literally identical (accession, start, end, source) are collapsed,
 *   which the InterPro API does not return.
 */

import { fetchWithRetry } from "@/lib/utils";
import type { ProteinDomain } from "@/types/protein-domain";
import type { ProteinIdentifierMapping } from "@/types/protein-domain";

// ── API configuration ─────────────────────────────────────────────────────────

const INTERPRO_ENTRY_URL = (uniprotAccession: string) =>
  `https://www.ebi.ac.uk/interpro/api/entry/all/protein/uniprot/${uniprotAccession}/?format=json&page_size=200`;

const INTERPRO_ENTRY_URL_BASE = (accession: string) =>
  `https://www.ebi.ac.uk/interpro/api/entry/${accession}/`;

// ── In-memory cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: ProteinDomain[];
  fetchedAt: number;
}

const domainCache = new Map<string, CacheEntry>();

function buildCacheKey(proteinAccession: string): string {
  return `proteindomain:${proteinAccession}`;
}

function getCached(proteinAccession: string): ProteinDomain[] | null {
  const entry = domainCache.get(buildCacheKey(proteinAccession));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    domainCache.delete(buildCacheKey(proteinAccession));
    return null;
  }
  return entry.data;
}

function setCached(proteinAccession: string, data: ProteinDomain[]): void {
  domainCache.set(buildCacheKey(proteinAccession), { data, fetchedAt: Date.now() });
}

export function isDomainCached(proteinAccession: string): boolean {
  return getCached(proteinAccession) !== null;
}

// ── Independent InterPro rate limiter ─────────────────────────────────────────
// Completely separate from NCBI, Reactome, and UniProt mapping limiters.
// EBI InterPro has no strict published rate limit; 400ms is conservative.

const INTERPRO_RATE_DELAY_MS = 400;

let interproFetchChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withInterproRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const next = interproFetchChain.then(() => fn());
  interproFetchChain = next
    .then(() => sleep(INTERPRO_RATE_DELAY_MS))
    .catch(() => sleep(INTERPRO_RATE_DELAY_MS));
  return next;
}

// ── InterPro API response types ───────────────────────────────────────────────
// Only fields consumed; extra fields ignored.

interface InterProFragment {
  start: number;
  end: number;
  "dc-status"?: string;
}

interface InterProEntryProteinLocation {
  fragments: InterProFragment[];
  model?: string;
}

interface InterProProteinEntry {
  accession?: string;
  entry_protein_locations?: InterProEntryProteinLocation[];
}

interface InterProMetadataName {
  name: string;
  short?: string;
}

interface InterProEntryMetadata {
  accession: string;
  name: InterProMetadataName | string | null;
  source_database: string;
  type?: string;
}

interface InterProEntry {
  metadata: InterProEntryMetadata;
  proteins?: InterProProteinEntry[];
}

interface InterProResponse {
  count?: number;
  next?: string | null;
  results?: InterProEntry[];
}

// ── Fetch (with pagination) ───────────────────────────────────────────────────

async function fetchInterProPage(url: string): Promise<InterProResponse> {
  const res = await fetchWithRetry(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ResearchCoPilot/1.0",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("HTTP 429 — InterPro API rate limit hit");
    }
    throw new Error(`InterPro API HTTP ${res.status} for ${url}`);
  }

  return res.json() as Promise<InterProResponse>;
}

async function fetchAllInterProEntries(uniprotAccession: string): Promise<InterProEntry[]> {
  const allEntries: InterProEntry[] = [];
  let nextUrl: string | null = INTERPRO_ENTRY_URL(uniprotAccession);

  while (nextUrl) {
    const page = await fetchInterProPage(nextUrl);
    const results = page.results ?? [];
    allEntries.push(...results);
    nextUrl = page.next ?? null;
  }

  return allEntries;
}

// ── Normalization ─────────────────────────────────────────────────────────────

function extractDomainName(metadata: InterProEntryMetadata): string {
  const name = metadata.name;
  if (!name) return metadata.accession;
  if (typeof name === "string") return name || metadata.accession;
  return name.name || name.short || metadata.accession;
}

/**
 * Convert InterPro API entries to ProteinDomain[].
 *
 * - Skips entries with no accession (malformed).
 * - Extracts all fragment location ranges from the protein's entry_protein_locations.
 *   Each fragment becomes a separate ProteinDomain (one domain per fragment).
 * - If no location data is present: creates one domain entry with null positions.
 * - Does NOT merge or deduplicate overlapping domains from different member databases.
 *   Each is a biologically valid, distinct annotation.
 * - Positions are 1-based residue numbers as returned by InterPro.
 */
function normalizeEntries(
  entries: InterProEntry[],
  proteinAccession: string,
  uniprotAccession: string,
  geneId: string,
  organism: string
): ProteinDomain[] {
  const results: ProteinDomain[] = [];

  for (const entry of entries) {
    const meta = entry.metadata;

    // Skip malformed entries individually
    if (!meta?.accession) continue;

    const domainName = extractDomainName(meta);
    const proteinMatches = entry.proteins ?? [];
    const proteinEntry = proteinMatches[0]; // There's one protein entry per result

    const locations = proteinEntry?.entry_protein_locations ?? [];

    if (locations.length === 0) {
      // No position data — emit the domain with null positions
      results.push({
        domainId: meta.accession,
        domainName,
        source: "interpro",
        startPosition: null,
        endPosition: null,
        proteinAccession,
        uniprotAccession,
        geneId,
        organism,
      });
      continue;
    }

    // Emit one ProteinDomain per fragment per location entry
    for (const loc of locations) {
      const fragments = loc.fragments ?? [];
      if (fragments.length === 0) {
        results.push({
          domainId: meta.accession,
          domainName,
          source: "interpro",
          startPosition: null,
          endPosition: null,
          proteinAccession,
          uniprotAccession,
          geneId,
          organism,
        });
        continue;
      }

      for (const frag of fragments) {
        const start = typeof frag.start === "number" ? frag.start : null;
        const end = typeof frag.end === "number" ? frag.end : null;
        results.push({
          domainId: meta.accession,
          domainName,
          source: "interpro",
          startPosition: start,
          endPosition: end,
          proteinAccession,
          uniprotAccession,
          geneId,
          organism,
        });
      }
    }
  }

  return results;
}

/**
 * Sort domains deterministically:
 *   1. startPosition ascending (null positions last)
 *   2. domainName as tiebreaker (alphabetical)
 */
function sortDomains(domains: ProteinDomain[]): ProteinDomain[] {
  return [...domains].sort((a, b) => {
    const aPos = a.startPosition;
    const bPos = b.startPosition;

    if (aPos === null && bPos === null) {
      return (a.domainName ?? "").localeCompare(b.domainName ?? "");
    }
    if (aPos === null) return 1;
    if (bPos === null) return -1;
    if (aPos !== bPos) return aPos - bPos;
    return (a.domainName ?? "").localeCompare(b.domainName ?? "");
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve protein domain annotations from InterPro for a given protein.
 *
 * Requires a resolved ProteinIdentifierMapping from ProteinIdentifierResolver.
 * Returns an empty array if the mapping is unresolved/ambiguous (Case A empty
 * state — caller is responsible for distinguishing from Case B / no domains).
 *
 * Cache: keyed by `proteindomain:{proteinAccession}`. TTL 24 hours.
 * Rate limit: 400ms sequential delay, independent from NCBI, Reactome, UniProt.
 *
 * @param mapping   Result from resolveProteinIdentifier() — must be "resolved".
 * @param geneId    NCBI Gene ID — for traceability on returned ProteinDomain objects.
 * @param organism  Organism scientific name — for traceability.
 * @returns Array of ProteinDomain, sorted by startPosition ascending, null last.
 *          Empty array if no domains annotated (Case B) or mapping failed (Case A).
 * @throws On network/HTTP error after retries exhausted.
 */
export async function getProteinDomains(
  mapping: ProteinIdentifierMapping,
  geneId: string,
  organism: string
): Promise<ProteinDomain[]> {
  const { refseqAccession, uniprotAccession } = mapping;

  // ── Case A: unresolved or ambiguous mapping ────────────────────────────────
  // Caller distinguishes this from Case B (resolved, no domains) via
  // mapping.resolutionStatus — not from the returned array alone.
  if (mapping.resolutionStatus !== "resolved" || !uniprotAccession) {
    return [];
  }

  // ── Cache hit ─────────────────────────────────────────────────────────────
  const cached = getCached(refseqAccession);
  if (cached !== null) return cached;

  // ── Rate-limited fetch ────────────────────────────────────────────────────
  return withInterproRateLimit(async () => {
    // Double-check cache after acquiring rate-limit slot
    const postWaitCached = getCached(refseqAccession);
    if (postWaitCached !== null) return postWaitCached;

    const entries = await fetchAllInterProEntries(uniprotAccession);
    const domains = normalizeEntries(entries, refseqAccession, uniprotAccession, geneId, organism);
    const sorted = sortDomains(domains);

    setCached(refseqAccession, sorted);
    return sorted;
  });
}
