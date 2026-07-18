/**
 * lib/variant/parse.ts — ClinVar ESummary → VariantRecord parser (Phase 5.5A)
 *
 * All parsing is defensive (never throws on malformed input).
 * All fabrication is prohibited: if a field cannot be reliably parsed, it is null.
 *
 * Key parsing decisions (from live API audit 2026-07-11):
 *
 * 1. variation_name format:
 *      "NM_000546.6(TP53):c.524G>A (p.Arg175His)"
 *      "NM_000546.6(TP53):c.1000_1004delinsTGGTGC (p.Gly334fs)"
 *      "NM_000546.6(TP53):c.524G>T (p.Arg175Leu)"
 *
 *    Parsed into ONE VariantTranscriptConsequence:
 *      transcriptAccession = "NM_000546.6" (with version)
 *      hgvsCoding = "c.524G>A"
 *      hgvsProtein = "p.Arg175His" (null for non-coding)
 *      proteinAccession = null (not in variation_name)
 *      isCanonical = null (cannot determine from ESummary)
 *
 * 2. dbSNP cross-reference:
 *      variation_xrefs[db_source="dbSNP"].db_id → rsID digits only
 *
 * 3. Gene fields:
 *      genes[0].geneid → geneId
 *      genes[0].symbol → geneSymbol
 *
 * 4. obj_type → variantType (as-is, never remapped)
 *
 * 5. genomicHgvs: always null (ESummary provides SPDI, not HGVS — conversion prohibited)
 */

import type { VariantRecord, VariantTranscriptConsequence } from "@/types/variant-record";
import type { RawClinVarESummaryEntry } from "./search";

// ── Transcript consequence parsing ────────────────────────────────────────────

/**
 * Regex for variation_name parsing.
 *
 * Matches: "{transcript}({gene}):{hgvsCoding}" optionally followed by " ({hgvsProtein})"
 *
 * Groups:
 *   1: transcript accession (e.g. "NM_000546.6")
 *   2: gene symbol inside parens (e.g. "TP53") — captured but not used
 *   3: hgvsCoding (e.g. "c.524G>A" or "c.1000_1004delinsTGGTGC")
 *   4: hgvsProtein (e.g. "p.Arg175His") — optional, absent for non-coding
 */
const VARIATION_NAME_RE =
  /^((NM|NR|XM|XR|NG)_\d+\.\d+)\([^)]+\):([^\s(]+)(?:\s+\(([^)]+)\))?/;

/**
 * Parse a ClinVar variation_name string into a VariantTranscriptConsequence.
 * Returns null when the string is absent, empty, or unparseable.
 */
export function parseVariationName(
  variationName: string | undefined | null
): VariantTranscriptConsequence | null {
  if (!variationName) return null;

  const match = variationName.match(VARIATION_NAME_RE);
  if (!match) return null;

  const transcriptAccession = match[1]; // e.g. "NM_000546.6"
  const hgvsCoding = match[3] || null;  // e.g. "c.524G>A"
  const hgvsProtein = match[4] || null; // e.g. "p.Arg175His"

  return {
    transcriptAccession,
    hgvsCoding,
    proteinAccession: null, // not available in ESummary variation_name
    hgvsProtein,
    isCanonical: null, // cannot determine from ESummary alone
  };
}

// ── dbSNP cross-reference extraction ─────────────────────────────────────────

/**
 * Extract the dbSNP rsID digits from variation_xrefs.
 * Returns the rsID digits only (without "rs" prefix), e.g. "28934578".
 * Returns null when no dbSNP xref is present.
 */
function extractDbsnpId(
  variationSet: RawClinVarESummaryEntry["variation_set"]
): string | null {
  const xrefs = variationSet?.[0]?.variation_xrefs;
  if (!xrefs) return null;
  const dbsnpRef = xrefs.find((x) => x.db_source === "dbSNP");
  return dbsnpRef?.db_id || null;
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a raw ClinVar ESummary entry into a VariantRecord.
 *
 * Returns null when the entry is missing critical fields (uid, genes, etc.)
 * that prevent a meaningful record from being constructed.
 */
export function parseVariantRecord(
  entry: RawClinVarESummaryEntry
): VariantRecord | null {
  // uid is mandatory — the stable key for everything downstream
  const uid = entry.uid?.trim();
  if (!uid) return null;

  // Gene info — mandatory for contextual display
  const genes = entry.genes;
  const primaryGene = genes?.[0];
  if (!primaryGene?.geneid || !primaryGene?.symbol) return null;

  const geneId = String(primaryGene.geneid);
  const geneSymbol = primaryGene.symbol;

  // Accession (VCV format)
  const clinvarAccession = entry.accession?.trim() || null;

  // dbSNP rsID
  const dbsnpId = extractDbsnpId(entry.variation_set);

  // Variant type (as-is)
  const variantType = entry.obj_type?.trim() || null;

  // Title (representative HGVS from ClinVar)
  const variationName = entry.variation_set?.[0]?.variation_name;
  const title = entry.title?.trim() || variationName?.trim() || null;

  // Transcript consequence — 0 or 1 entries (ESummary limitation)
  const parsedConsequence = parseVariationName(variationName);
  const transcriptConsequences: VariantTranscriptConsequence[] =
    parsedConsequence ? [parsedConsequence] : [];

  // Molecular consequence types
  const molecularConsequences: string[] = Array.isArray(
    entry.molecular_consequence_list
  )
    ? entry.molecular_consequence_list.filter(Boolean)
    : [];

  return {
    source: "clinvar",
    clinvarVariationId: uid,
    clinvarAccession,
    dbsnpId,
    geneId,
    geneSymbol,
    organism: "Homo sapiens", // ClinVar is human-centric
    variantType,
    genomicHgvs: null, // ESummary provides SPDI, not HGVS; conversion prohibited
    title,
    transcriptConsequences,
    molecularConsequences,
    sourceDatabase: "clinvar",
  };
}
