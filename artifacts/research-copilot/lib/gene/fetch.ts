/**
 * lib/gene/fetch.ts — NCBI Gene ESummary (Path A) for Gene Explorer (Phase 5.2)
 *
 * Path A covers core gene fields available from NCBI Gene ESummary (db=gene, retmode=json).
 *
 * Fields available from ESummary (confirmed by pre-code live API inspection, 2026-07-01):
 *   uid           → geneId
 *   name          → officialSymbol
 *   description   → fullName
 *   chromosome    → chromosome
 *   maplocation   → cytogeneticLocation
 *   genomicinfo[] → genomicStart, genomicEnd, strand (from chrstart/chrstop comparison)
 *   summary       → summary text
 *   otheraliases  → aliases (comma-separated string)
 *   mim[]         → omimId (first entry, or null if empty)
 *   organism      → organism name + taxonomyId
 *
 * Fields NOT available from ESummary (documented during inspection):
 *   genetype      → always null/None in ESummary v0.3 for all genes tested
 *                   (TP53, BRCA2, EGFR, PTEN, mouse Trp53). Requires EFetch XML.
 *
 * This module does not call ELink — that is handled by lib/gene/links.ts (Path B).
 */

import {
  geneESummary,
  type RawGeneESummaryEntry,
} from "./search";

export type { RawGeneESummaryEntry };

/**
 * Fetch ESummary data for a single gene ID.
 * Returns null when the ID is not found or all results are discontinued.
 */
export async function fetchGeneSummaryById(
  geneId: string
): Promise<RawGeneESummaryEntry | null> {
  const entries = await geneESummary([geneId]);
  return entries[0] ?? null;
}

/**
 * Fetch ESummary data for multiple gene IDs (up to 10 per call).
 * Used for multi-organism search results (Step 4).
 */
export async function fetchGeneSummariesByIds(
  geneIds: string[]
): Promise<RawGeneESummaryEntry[]> {
  if (geneIds.length === 0) return [];
  return geneESummary(geneIds.slice(0, 10));
}
