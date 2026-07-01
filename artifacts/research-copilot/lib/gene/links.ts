/**
 * lib/gene/links.ts — NCBI ELink llinks (Path B) for Gene Explorer (Phase 5.2)
 *
 * Path B provides cross-database identifiers NOT available from ESummary (Path A).
 *
 * Pre-code inspection findings (2026-07-01, TP53 gene ID 7157):
 *
 *   Endpoint: elink.fcgi?dbfrom=gene&id={geneId}&cmd=llinks&retmode=json
 *
 *   Ensembl ID: extracted from Bgee database URL in the llinks response.
 *     Bgee URL pattern: "https://www.bgee.org/gene/ENSG00000141510"
 *     Regex: /(ENS[A-Z]*G\d+)/ — matches ENSG (human), ENSMUSG (mouse), etc.
 *     Example result: ENSG00000141510 for TP53.
 *
 *   HGNC ID: NOT reliably extractable from llinks.
 *     The llinks output contains a GenAge URL with the HGNC symbol (not ID number),
 *     and no direct "HGNC:XXXXX" format identifiers were found in the llinks JSON
 *     for TP53. HGNC ID would require EFetch XML Dbtag parsing.
 *     → hgncId always null in Phase 5.2.
 *
 * Rate limit note:
 *   ELink llinks is a SEPARATE NCBI Entrez call that draws from the shared 3 req/s budget.
 *   Per the spec (Step 5), ELink calls for cross-database IDs are fetched:
 *   - EAGERLY for single-gene results (initial page showing one gene card)
 *   - LAZILY (deferred to expand/select) for multi-gene list results
 *     to avoid firing N ELink calls simultaneously on page load.
 *
 * This module is independently failable (Path B failure ≠ Path A failure):
 *   - If this function throws, the caller (lib/gene/index.ts) catches and sets
 *     all cross-database fields to null with linkEnrichment = "partial".
 *   - Path A core data is always shown; cross-database IDs gracefully degrade.
 */

const NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// ── Regex for Ensembl gene IDs ────────────────────────────────────────────────
// Matches: ENSG (human), ENSMUSG (mouse), ENSRNOG (rat), ENSGALG (chicken), etc.
// Pattern confirmed against Bgee URL: https://www.bgee.org/gene/ENSG00000141510
const ENSEMBL_ID_RE = /ENS[A-Z]*G\d{11}/;

// ── Raw ELink response shape ──────────────────────────────────────────────────

interface ELinkLLinksResponse {
  linksets?: Array<{
    idurllist?: Array<{
      objurls?: Array<{
        provider?: { name?: string };
        url?: { value?: string };
      }>;
    }>;
  }>;
}

// ── Main function ─────────────────────────────────────────────────────────────

export interface LinkEnrichmentResult {
  ensemblId: string | null;
  hgncId: string | null;
  geneRifCount: number | null;
}

/**
 * Fetch cross-database identifiers for a gene via NCBI ELink llinks.
 *
 * Independently failable — callers should catch errors and treat as "partial" enrichment.
 *
 * @param geneId  NCBI Gene ID (numeric string).
 * @returns Cross-database identifiers. Fields are null when not found or not available.
 */
export async function fetchGeneLinks(geneId: string): Promise<LinkEnrichmentResult> {
  const url =
    `${NCBI_BASE}/elink.fcgi?dbfrom=gene&id=${encodeURIComponent(geneId)}` +
    `&cmd=llinks&retmode=json`;

  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchCoPilot/1.0 (contact: dev@example.com)" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error("HTTP 429 Too Many Requests (NCBI rate limit)");
    throw new Error(`HTTP ${res.status} from NCBI ELink: ${url}`);
  }

  const data = (await res.json()) as ELinkLLinksResponse;

  let ensemblId: string | null = null;

  for (const linkset of data.linksets ?? []) {
    for (const entry of linkset.idurllist ?? []) {
      for (const obj of entry.objurls ?? []) {
        const urlValue = obj.url?.value ?? "";
        // Bgee URL contains Ensembl ID: https://www.bgee.org/gene/ENSG00000141510
        // Also check Ensembl.org URLs if present
        if (urlValue.includes("bgee.org") || urlValue.includes("ensembl.org")) {
          const match = ENSEMBL_ID_RE.exec(urlValue);
          if (match) {
            ensemblId = match[0];
            break;
          }
        }
      }
      if (ensemblId) break;
    }
    if (ensemblId) break;
  }

  return {
    ensemblId,
    // HGNC ID: not available from llinks — requires EFetch XML Dbtag parsing (Phase 5.3+)
    hgncId: null,
    // GeneRIF count: not available from llinks — requires separate elink gene→pubmed call
    geneRifCount: null,
  };
}
