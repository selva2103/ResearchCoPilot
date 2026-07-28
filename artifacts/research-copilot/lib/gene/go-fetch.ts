/**
 * lib/gene/go-fetch.ts — Gene EFetch XML retrieval + GO annotation extraction (Phase 5.6A)
 *
 * AUDIT FINDING (Phase 5.6A, 2026-07-27):
 *   The Gene Explorer (Phase 5.2) uses ESummary JSON — NOT EFetch XML.
 *   This module adds the first Gene EFetch XML call (db=gene, rettype=xml).
 *   This is NOT a new third-party service — same NCBI EFetch endpoint already used
 *   for ClinVar (lib/clinical-evidence/clinvar-retrieval.ts) and transcript downloads.
 *
 * CACHING:
 *   Key:  go:{geneId}
 *   TTL:  24 hours — GO annotations change infrequently (monthly releases).
 *   Implementation: in-memory Map, same pattern as lib/variant-research-context/index.ts.
 *   Cache is keyed by geneId (NCBI Gene ID) — NOT by goId (a GO term identifier shared
 *   across many genes — see Phase 5.6A spec §8 performance requirements).
 *
 * RATE LIMIT:
 *   Reuses GENE_RATE_DELAY_MS (350ms) and sleep() from lib/gene/search.ts.
 *   Uses a module-level sequential promise chain — same pattern as other endpoints.
 *   fetchWithRetry handles HTTP 429 with exponential backoff.
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId, geneSymbol, and organism are consumed from the already-resolved Gene context.
 *   This module never independently re-resolves gene, transcript, protein, or organism.
 */

import { fetchWithRetry } from "@/lib/utils";
import { parseGoAnnotations } from "@/lib/gene/go-parser";
import { GENE_RATE_DELAY_MS, sleep, NCBI_BASE } from "@/lib/gene/search";
import type { FunctionalAnnotation } from "@/types/functional-annotation";

// ── In-memory cache ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  data: FunctionalAnnotation[];
  fetchedAt: number;
}

const goCache = new Map<string, CacheEntry>();

function buildCacheKey(geneId: string): string {
  return `go:${geneId}`;
}

function getCached(geneId: string): FunctionalAnnotation[] | null {
  const key = buildCacheKey(geneId);
  const entry = goCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    goCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(geneId: string, data: FunctionalAnnotation[]): void {
  goCache.set(buildCacheKey(geneId), { data, fetchedAt: Date.now() });
}

export function isGoAnnotationsCached(geneId: string): boolean {
  return getCached(geneId) !== null;
}

// ── Module-level rate-limit chain ───────────────────────────────────────────
// Sequential promise chain: each call awaits the previous one + delay.
// Same pattern as other rate-limited modules in this codebase.

let goFetchChain: Promise<void> = Promise.resolve();

function withGoRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  const next = goFetchChain.then(() => fn());
  // Chain the delay so subsequent calls wait even if this one resolves early.
  goFetchChain = next
    .then(() => sleep(GENE_RATE_DELAY_MS))
    .catch(() => sleep(GENE_RATE_DELAY_MS));
  return next;
}

// ── EFetch XML fetch ─────────────────────────────────────────────────────────

/**
 * Fetch the full Gene EFetch XML for a given NCBI Gene ID.
 *
 * @param geneId  NCBI Gene ID (numeric string), e.g. "7157"
 * @returns Raw XML string, or throws on HTTP/network error.
 *
 * NOTE: The Gene EFetch XML for highly-studied genes (e.g. TP53) can be 30MB+.
 * This is unavoidable given the source — the parser handles it without loading
 * it into a DOM, using string-based regex extraction instead.
 */
async function fetchGeneEFetchXml(geneId: string): Promise<string> {
  const params = new URLSearchParams({
    db: "gene",
    id: geneId,
    rettype: "xml",
    retmode: "xml",
  });
  const url = `${NCBI_BASE}/efetch.fcgi?${params.toString()}`;
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
    }
    throw new Error(`Gene EFetch HTTP ${res.status} for geneId=${geneId}`);
  }
  return res.text();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve and parse GO functional annotations for a gene.
 *
 * Fetches the Gene EFetch full XML (db=gene, rettype=xml) and extracts
 * GO annotations from the GeneOntology section.
 *
 * Cache: keyed by geneId. 24-hour TTL.
 * Rate limit: sequential 350ms delay, consistent with other gene module calls.
 *
 * @param geneId      NCBI Gene ID — already resolved upstream; NOT re-derived here.
 * @param geneSymbol  Gene symbol — passed through as display label only.
 * @param organism    Organism scientific name — passed through as display label only.
 * @returns Array of FunctionalAnnotation (may be empty for unannotated genes).
 * @throws On network/HTTP error after retries exhausted.
 */
export async function getGeneGoAnnotations(
  geneId: string,
  geneSymbol: string,
  organism: string,
): Promise<FunctionalAnnotation[]> {
  // ── Cache hit ───────────────────────────────────────────────────────────────
  const cached = getCached(geneId);
  if (cached !== null) return cached;

  // ── Rate-limited fetch ───────────────────────────────────────────────────────
  return withGoRateLimit(async () => {
    // Double-check cache after acquiring the rate-limit slot (another request
    // may have populated it while we were waiting).
    const postWaitCached = getCached(geneId);
    if (postWaitCached !== null) return postWaitCached;

    const xml = await fetchGeneEFetchXml(geneId);
    const annotations = parseGoAnnotations(xml, geneId, geneSymbol, organism);
    setCached(geneId, annotations);
    return annotations;
  });
}
