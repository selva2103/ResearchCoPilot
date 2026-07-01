/**
 * lib/resolver/fetch.ts — Shared NCBI Entrez fetch utility for the Biological Query Resolver.
 *
 * Mirrors the pattern in lib/genbank/search.ts but kept separate so the resolver
 * remains provider-independent and can later call non-NCBI endpoints (HGNC, MeSH REST, etc.)
 * without polluting the GenBank module.
 */

export const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/**
 * Delay between sequential NCBI calls.
 * NCBI allows 3 requests/second without an API key.
 * 350 ms gives ~2.9 req/s — intentionally slightly under the limit.
 */
export const RESOLVER_RATE_DELAY_MS = 350;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a NCBI Entrez URL and return the parsed JSON.
 *
 * Retries up to `maxRetries` times on HTTP 429 with exponential backoff
 * (2 s, then 4 s). During the initial page load the resolver runs after
 * PubMed and GEO have already consumed part of the rate-limit window, so
 * a short retry handles transient 429s without surfacing an error to users.
 *
 * Throws on any non-429 HTTP error or after all retries are exhausted.
 */
export async function resolverFetch(url: string, maxRetries = 2): Promise<unknown> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 2 s on first retry, 4 s on second
      await sleep(2000 * attempt);
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "ResearchCoPilot/1.0 (Biological Query Resolver; contact: admin@example.com)",
      },
    });

    if (res.status === 429) {
      lastError = new Error(
        `NCBI rate-limited (HTTP 429); attempt ${attempt + 1}/${maxRetries + 1}`
      );
      continue; // retry after backoff
    }

    if (!res.ok) {
      throw new Error(`NCBI HTTP ${res.status} for ${url.slice(0, 120)}`);
    }

    return res.json();
  }

  throw lastError ?? new Error("NCBI fetch failed after all retries");
}
