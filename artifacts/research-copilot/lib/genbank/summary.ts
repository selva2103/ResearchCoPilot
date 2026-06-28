/**
 * genbank/summary.ts — Assembly and NucCore batch summary fetching with Rule 2 sorting.
 *
 * Key function: selectBestAssembly
 * Applies Rule 2: sort assemblies by refseq_category priority
 *   "reference genome" > "representative genome" > "other assembly"
 * among assemblies with a GCF_ accession (RefSeq), then falls back to GCA_.
 *
 * Observed assembly db fields (from live inspection of GCF_000195955.2):
 *   - assemblyaccession: "GCF_000195955.2"
 *   - assemblyname: "ASM19595v2"
 *   - assemblystatus: "Complete Genome" (NOT `assemblylevel` — that field is null)
 *   - refseq_category: "reference genome" | "representative genome" | "na"
 *   - ftppath_refseq: "ftp://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/..."
 *   - ftppath_genbank: "ftp://..."
 *   - synonym: { genbank: "GCA_...", refseq: "GCF_...", similarity: "identical" }
 *   - organism: "Mycobacterium tuberculosis H37Rv (high G+C Gram-positive bacteria)"
 *   - taxid, speciesname, contign50, lastupdatedate, etc.
 */

import type {
  AssemblyESummaryEntry,
  NucCoreESummaryEntry,
} from "./search";

// ── Assembly batch sorting (Rule 2) ──────────────────────────────────────────

/** Priority order for refseq_category — lower index = higher priority */
const REFSEQ_CATEGORY_PRIORITY: Record<string, number> = {
  "reference genome": 0,
  "representative genome": 1,
};

function refseqCategoryScore(cat: string | undefined): number {
  const c = (cat ?? "").toLowerCase();
  const score = REFSEQ_CATEGORY_PRIORITY[c];
  return score !== undefined ? score : 2;
}

/**
 * Select the best assembly from a batch, applying Rule 2.
 *
 * Priority order:
 *   1. GCF_ accession + refseq_category = "reference genome"
 *   2. GCF_ accession + refseq_category = "representative genome"
 *   3. GCF_ accession + assemblystatus = "Complete Genome"
 *   4. Any accession + best available refseq_category
 *   5. First available entry (last resort)
 */
export function selectBestAssembly(
  entries: AssemblyESummaryEntry[]
): { best: AssemblyESummaryEntry; alternates: AssemblyESummaryEntry[] } | null {
  if (entries.length === 0) return null;

  // Filter to entries that have a valid accession
  const valid = entries.filter((e) => e.assemblyaccession);
  if (valid.length === 0) return null;

  // Separate GCF_ (RefSeq) from GCA_ (GenBank)
  const gcf = valid.filter((e) => e.assemblyaccession?.startsWith("GCF_"));
  const gca = valid.filter((e) => e.assemblyaccession?.startsWith("GCA_"));

  // Sort GCF by refseq_category priority, then by assemblystatus completeness
  const sortedGcf = gcf.sort((a, b) => {
    const catDiff = refseqCategoryScore(a.refseq_category) - refseqCategoryScore(b.refseq_category);
    if (catDiff !== 0) return catDiff;
    // Secondary sort: Complete Genome > Chromosome > Scaffold > Contig
    const statusOrder = ["Complete Genome", "Chromosome", "Scaffold", "Contig"];
    const aIdx = statusOrder.indexOf(a.assemblystatus ?? "");
    const bIdx = statusOrder.indexOf(b.assemblystatus ?? "");
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  if (sortedGcf.length > 0) {
    const best = sortedGcf[0];
    // Alternates: next 2-3 GCF entries with different refseq_category or same category
    const alternates = sortedGcf.slice(1, 3);
    return { best, alternates };
  }

  // No GCF_ found — fall back to GCA_
  const sortedGca = gca.sort(
    (a, b) => refseqCategoryScore(a.refseq_category) - refseqCategoryScore(b.refseq_category)
  );
  if (sortedGca.length > 0) {
    return { best: sortedGca[0], alternates: sortedGca.slice(1, 3) };
  }

  return null;
}

/**
 * Parse the total genome length from the NCBI assembly `meta` XML Stats string.
 *
 * The meta field looks like:
 * " <Stats> <Stat category="total_length" sequence_tag="all">4411532</Stat> ..."
 *
 * Returns the total_length value as a number, or undefined if not parseable.
 */
export function parseAssemblyTotalLength(meta: string | undefined): number | undefined {
  if (!meta) return undefined;
  const match = meta.match(/category="total_length"[^>]*>(\d+)</);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

/**
 * Derives sequenceLengthUnit from resourceCategory and NCBI moltype.
 *
 * Rule: derive the unit in ONE place so sequenceLength and sequenceLengthUnit
 * cannot drift out of sync. Never set them independently.
 *
 *   Protein          → "aa"
 *   RNA moltype      → "nt"
 *   All others       → "bp"
 */
export function deriveSequenceLengthUnit(
  resourceCategory: string,
  moltype?: string
): "bp" | "nt" | "aa" {
  if (resourceCategory === "Protein") return "aa";
  if (moltype?.toLowerCase() === "rna") return "nt";
  return "bp";
}

/**
 * Select the best RefSeq NucCore record from a list.
 *
 * Rule 1: prefer sourcedb="refseq" over "insd".
 * Among RefSeq records: prefer completeness="complete".
 */
export function selectBestNucCore(
  entries: NucCoreESummaryEntry[]
): NucCoreESummaryEntry | null {
  if (entries.length === 0) return null;

  const refseq = entries.filter((e) => e.sourcedb === "refseq");
  const nonRefseq = entries.filter((e) => e.sourcedb !== "refseq");

  const candidates = refseq.length > 0 ? refseq : nonRefseq;

  // Prefer complete genomes
  const complete = candidates.filter((e) => e.completeness === "complete");
  return complete.length > 0 ? complete[0] : candidates[0];
}
