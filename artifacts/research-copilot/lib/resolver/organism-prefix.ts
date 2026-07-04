/**
 * lib/resolver/organism-prefix.ts — Organism prefix detection for species-qualified gene queries
 *
 * Detects patterns like "mouse CD4", "rat EGFR", "zebrafish Sox2" and extracts:
 *   - The organism (taxId + NCBI scientific name)
 *   - The gene symbol with the organism prefix stripped
 *
 * Supported prefixes come from the spec (ORGANISM-AWARE GENE RANKING PATCH) and include
 * the most commonly used model organism common names in the literature.
 *
 * This module is called as a pre-step in lib/resolver/index.ts BEFORE the main
 * synonym-normalization and resolver pipeline. If a prefix is detected the resolver
 * immediately tries a taxId-filtered gene search and short-circuits, so the organism
 * context is never lost downstream.
 */

export interface OrganismPrefixDetection {
  /** NCBI Taxonomy ID for the detected organism. */
  taxId: number;
  /** NCBI scientific name (e.g. "Mus musculus"). */
  name: string;
  /** The gene symbol / query remainder after stripping the organism prefix. */
  strippedQuery: string;
}

/** Supported organism prefixes — order matters (more specific patterns first). */
const ORGANISM_PREFIXES: {
  pattern: RegExp;
  taxId: number;
  name: string;
}[] = [
  // Human (9606)
  { pattern: /^(?:human|homo)\s+/i, taxId: 9606, name: "Homo sapiens" },
  // Mouse (10090) — "murine" is the adjective form
  { pattern: /^(?:mouse|murine)\s+/i, taxId: 10090, name: "Mus musculus" },
  // Rat (10116)
  { pattern: /^rat\s+/i, taxId: 10116, name: "Rattus norvegicus" },
  // Zebrafish (7955)
  { pattern: /^zebrafish\s+/i, taxId: 7955, name: "Danio rerio" },
  // Drosophila / Fruit fly (7227)
  { pattern: /^(?:fly|drosophila)\s+/i, taxId: 7227, name: "Drosophila melanogaster" },
  // C. elegans / Roundworm (6239)
  { pattern: /^(?:worm|c\.\s*elegans)\s+/i, taxId: 6239, name: "Caenorhabditis elegans" },
  // Yeast (4932) — budding yeast (S. cerevisiae)
  { pattern: /^yeast\s+/i, taxId: 4932, name: "Saccharomyces cerevisiae" },
  // Arabidopsis (3702)
  { pattern: /^arabidopsis\s+/i, taxId: 3702, name: "Arabidopsis thaliana" },
  // Chicken (9031)
  { pattern: /^chicken\s+/i, taxId: 9031, name: "Gallus gallus" },
];

/**
 * Broader gene-symbol pattern for the stripped remainder.
 *
 * Intentionally allows mixed-case (Trp53, Sox2, lacZ, EGFR) because non-human gene
 * symbols often use mixed capitalisation (e.g. Mus musculus uses sentence-case: Trp53,
 * Brca1, Cdkn2a). The resolver's own GENE_SYMBOL_RE is uppercase-only — this broader
 * pattern is used only in the organism-prefix code path.
 *
 * Guard: at least one uppercase letter OR digit prevents lowercase common words like
 * "receptor" or "kinase" from being treated as gene symbols.
 */
const GENE_SYMBOL_RE_BROAD = /^[A-Za-z][A-Za-z0-9]{1,15}$/;

function looksLikeGeneSymbol(s: string): boolean {
  return GENE_SYMBOL_RE_BROAD.test(s) && /[A-Z0-9]/.test(s);
}

/**
 * Detect an organism prefix at the start of a query string.
 *
 * Returns null when:
 *   - No organism prefix matches (unchanged behaviour for unqualified queries)
 *   - The remainder after stripping the prefix is empty or too short (e.g. "mouse" alone)
 *   - The remainder contains spaces (e.g. "mouse tumor protein p53") — multi-word remainders
 *     are not gene symbols and should route through the normal pipeline
 *   - The remainder does not resemble a gene symbol (no uppercase letter or digit)
 */
export function detectOrganismPrefix(
  query: string
): OrganismPrefixDetection | null {
  const trimmed = query.trim();

  for (const { pattern, taxId, name } of ORGANISM_PREFIXES) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const stripped = trimmed.slice(match[0].length).trim();

    // "mouse" alone — no gene symbol present
    if (stripped.length < 2) return null;

    // Multi-word remainder (e.g. "mouse tumor protein 53") — not a gene symbol
    if (/\s/.test(stripped)) return null;

    // Must look like a gene symbol
    if (!looksLikeGeneSymbol(stripped)) return null;

    return { taxId, name, strippedQuery: stripped };
  }

  return null;
}
