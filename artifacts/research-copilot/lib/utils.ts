export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function encodeQuery(query: string): string {
  return encodeURIComponent(query.trim());
}

/**
 * Fetch wrapper that retries on HTTP 429 (NCBI rate limit) with a delay.
 * NCBI's unauthenticated limit is 3 req/s — this gives the server time to reset.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 2,
  retryDelayMs = 1500
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    lastResponse = res;
  }
  return lastResponse!;
}
