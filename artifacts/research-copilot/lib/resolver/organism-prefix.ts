/**
 * lib/resolver/organism-prefix.ts — Organism prefix/suffix detection for
 * species-qualified gene queries.
 *
 * Detects patterns like "mouse CD4", "rat EGFR", "zebrafish Sox2" (prefix) and
 * "Trp53 Mus musculus", "BRCA2 human" (suffix) and extracts:
 *   - The organism (taxId + NCBI scientific name)
 *   - The gene symbol with the organism prefix/suffix stripped
 *
 * Both directions are derived from the single canonical lookup table in
 * organism-synonyms.ts (Phase R Bug 13) so they never drift out of sync.
 *
 * This module is called as a pre-step in lib/resolver/index.ts BEFORE the main
 * synonym-normalization and resolver pipeline. If a match is detected the
 * resolver immediately tries a taxId-filtered gene search, so the organism
 * context is never lost downstream.
 */

import { ORGANISM_SYNONYM_KEYS, resolveOrganismSynonym } from "./organism-synonyms";

export interface OrganismPrefixDetection {
  /** NCBI Taxonomy ID for the detected organism. */
  taxId: number;
  /** NCBI scientific name (e.g. "Mus musculus"). */
  name: string;
  /** The gene symbol / query remainder after stripping the organism prefix. */
  strippedQuery: string;
  /** The literal synonym text that matched (e.g. "mouse"). */
  matchedSynonym: string;
}

export interface OrganismSuffixDetection {
  taxId: number;
  name: string;
  strippedQuery: string;
  matchedSynonym: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Organism prefixes/suffixes, derived from the canonical ORGANISM_SYNONYMS
 * table (organism-synonyms.ts) so prefix and suffix detection never drift out
 * of sync (Bug 13). Longest synonyms are checked first so multi-word
 * scientific names win over their component words.
 */
const ORGANISM_PREFIXES: {
  pattern: RegExp;
  taxId: number;
  name: string;
  matchedSynonym: string;
}[] = ORGANISM_SYNONYM_KEYS.map((key) => {
  const entry = resolveOrganismSynonym(key)!;
  return {
    pattern: new RegExp(`^${escapeRegExp(key)}\\s+`, "i"),
    taxId: entry.taxId,
    name: entry.name,
    matchedSynonym: key,
  };
});

const ORGANISM_SUFFIXES: {
  pattern: RegExp;
  taxId: number;
  name: string;
  matchedSynonym: string;
}[] = ORGANISM_SYNONYM_KEYS.map((key) => {
  const entry = resolveOrganismSynonym(key)!;
  return {
    pattern: new RegExp(`\\s+${escapeRegExp(key)}$`, "i"),
    taxId: entry.taxId,
    name: entry.name,
    matchedSynonym: key,
  };
});

/**
 * Broader gene-symbol pattern for the stripped remainder.
 *
 * Intentionally allows mixed-case (Trp53, Sox2, lacZ, EGFR) AND all-lowercase
 * (shha, white, eve, ftz — real, official gene symbols under zebrafish and
 * Drosophila nomenclature conventions) because non-human gene symbols are not
 * restricted to the human ALL-CAPS convention. The resolver's own
 * GENE_SYMBOL_RE is uppercase-only — this broader pattern is used only in the
 * organism-prefix/suffix code path.
 *
 * No uppercase/digit guard here (Phase R Bug 1 fix, 2026-10-28): that guard
 * previously rejected genuine all-lowercase non-human symbols like "shha" and
 * "white" before they ever reached NCBI. Correctness is enforced downstream
 * instead — the caller (index.ts) runs a real taxId-filtered NCBI Gene search
 * for the stripped remainder against the matched organism, and a shape match
 * here that is not a real gene (e.g. "mouse receptor") simply returns no
 * results there, same end behavior as today, verified live rather than
 * guessed from a regex heuristic.
 */
const GENE_SYMBOL_RE_BROAD = /^[A-Za-z][A-Za-z0-9]{1,15}$/;

function looksLikeGeneSymbol(s: string): boolean {
  return GENE_SYMBOL_RE_BROAD.test(s);
}

/**
 * Detect an organism prefix at the start of a query string.
 *
 * Returns null when:
 *   - No organism prefix matches (unchanged behaviour for unqualified queries)
 *   - The remainder after stripping the prefix is empty or too short (e.g. "mouse" alone)
 *   - The remainder contains spaces (e.g. "mouse tumor protein p53") — multi-word remainders
 *     are not gene symbols and should route through the normal pipeline
 *   - The remainder is not a single alphanumeric token of 2-16 characters starting with a letter
 */
export function detectOrganismPrefix(
  query: string
): OrganismPrefixDetection | null {
  const trimmed = query.trim();

  for (const { pattern, taxId, name, matchedSynonym } of ORGANISM_PREFIXES) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const stripped = trimmed.slice(match[0].length).trim();

    // "mouse" alone — no gene symbol present
    if (stripped.length < 2) return null;

    // Multi-word remainder (e.g. "mouse tumor protein 53") — not a gene symbol
    if (/\s/.test(stripped)) return null;

    // Must look like a gene symbol
    if (!looksLikeGeneSymbol(stripped)) return null;

    return { taxId, name, strippedQuery: stripped, matchedSynonym };
  }

  return null;
}

/**
 * Detect an organism suffix at the END of a query string (Phase R Bug 2/12).
 *
 * Handles patterns like "Trp53 Mus musculus" (multi-word scientific name) and
 * "BRCA2 human" / "Cd4 mouse" (single-word common name). Mirrors
 * detectOrganismPrefix's remainder validation: the leading remainder must be a
 * single gene-symbol-shaped token.
 */
export function detectOrganismSuffix(
  query: string
): OrganismSuffixDetection | null {
  const trimmed = query.trim();

  for (const { pattern, taxId, name, matchedSynonym } of ORGANISM_SUFFIXES) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const stripped = trimmed.slice(0, trimmed.length - match[0].length).trim();

    if (stripped.length < 2) return null;
    if (/\s/.test(stripped)) return null;
    if (!looksLikeGeneSymbol(stripped)) return null;

    return { taxId, name, strippedQuery: stripped, matchedSynonym };
  }

  return null;
}
