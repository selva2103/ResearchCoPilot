/**
 * lib/gene/parser.ts — Normalize NCBI Gene ESummary + ELink data → GeneRecord
 *
 * Converts raw NCBI API response objects into the strongly-typed GeneRecord
 * interface defined in types/gene-record.ts.
 *
 * Coordinate conventions (from live API inspection, 2026-07-01):
 *   ESummary genomicinfo[0].chrstart and chrstop are 0-based half-open coordinates.
 *   When chrstart > chrstop, the gene is on the minus strand.
 *   genomicStart is always min(chrstart, chrstop) — the lower coordinate.
 *   genomicEnd   is always max(chrstart, chrstop) — the higher coordinate.
 *   strand = chrstart > chrstop ? "-" : "+"
 *
 * Ensembl URL pattern:
 *   Human (taxid 9606):   https://www.ensembl.org/Homo_sapiens/Gene/Summary?g={ensemblId}
 *   Non-human:            null (organism-specific Ensembl subdomain not constructed)
 *
 * OMIM URL pattern:
 *   https://www.omim.org/entry/{omimId}
 *
 * NCBI Gene URL pattern:
 *   https://www.ncbi.nlm.nih.gov/gene/{geneId}
 */

import type { GeneRecord } from "@/types/gene-record";
import type { RawGeneESummaryEntry } from "./search";
import type { LinkEnrichmentResult } from "./links";

/** Taxonomy ID for Homo sapiens — used for human-specific URL construction. */
const HUMAN_TAXID = 9606;

/**
 * Parse a raw NCBI Gene ESummary entry + optional ELink enrichment data into GeneRecord.
 *
 * @param entry           Raw ESummary entry (Path A)
 * @param links           Cross-database identifiers from ELink (Path B). null when skipped/failed.
 * @param resolutionPath  Which route was taken to reach this record.
 * @param linkStatus      Whether ELink enrichment ran, partially failed, or was skipped.
 * @param enrichmentNote  Optional note when linkStatus is "partial".
 */
export function parseGeneRecord(
  entry: RawGeneESummaryEntry,
  links: LinkEnrichmentResult | null,
  resolutionPath: GeneRecord["resolutionPath"],
  linkStatus: GeneRecord["linkEnrichment"],
  enrichmentNote?: string
): GeneRecord {
  const geneId = entry.uid;

  // ── Genomic coordinates and strand ─────────────────────────────────────────
  const gi = entry.genomicinfo?.[0] ?? null;
  let genomicStart: number | null = null;
  let genomicEnd: number | null = null;
  let strand: GeneRecord["strand"] = null;

  if (gi) {
    // chrstart > chrstop means minus strand (NCBI convention)
    if (gi.chrstart > gi.chrstop) {
      genomicStart = gi.chrstop;
      genomicEnd = gi.chrstart;
      strand = "-";
    } else {
      genomicStart = gi.chrstart;
      genomicEnd = gi.chrstop;
      strand = "+";
    }
  }

  // ── Aliases ────────────────────────────────────────────────────────────────
  const aliases = entry.otheraliases
    ? entry.otheraliases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // ── OMIM ID ────────────────────────────────────────────────────────────────
  const mim = entry.mim ?? [];
  const omimId = mim.length > 0 ? mim[0] : null;

  // ── Summary text ───────────────────────────────────────────────────────────
  // Treat empty string the same as absent — UI renders the fallback message.
  const summary =
    entry.summary && entry.summary.trim().length > 0 ? entry.summary.trim() : null;

  // ── Chromosome ─────────────────────────────────────────────────────────────
  const chromosome =
    entry.chromosome && entry.chromosome.trim().length > 0
      ? entry.chromosome.trim()
      : null;

  // ── Cytogenetic location ───────────────────────────────────────────────────
  const cytogeneticLocation =
    entry.maplocation && entry.maplocation.trim().length > 0
      ? entry.maplocation.trim()
      : null;

  // ── Cross-database IDs (from Path B, or null when not fetched) ─────────────
  const ensemblId = links?.ensemblId ?? null;
  const hgncId = links?.hgncId ?? null;
  const geneRifCount = links?.geneRifCount ?? null;

  // ── URL construction ───────────────────────────────────────────────────────
  const ncbiGeneUrl = `https://www.ncbi.nlm.nih.gov/gene/${geneId}`;

  // Ensembl URL: human-only (ENSG prefix + taxid 9606)
  let ensemblUrl: string | null = null;
  if (ensemblId && entry.organism.taxid === HUMAN_TAXID) {
    ensemblUrl = `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${ensemblId}`;
  }

  const omimUrl = omimId ? `https://www.omim.org/entry/${omimId}` : null;

  // ── Transcript / protein availability flags ─────────────────────────────────
  // exonCount from genomicinfo is used only as an initial "available" heuristic
  // before the Transcript Explorer module runs. count/records/maneSelectPresent
  // are filled in by app/api/analyze/route.ts after calling searchTranscripts()
  // for the primary resolved gene — this parser has no NCBI transcript data yet.
  const exonCount = gi?.exoncount ?? null;

  const transcripts: GeneRecord["transcripts"] = {
    available: exonCount !== null && exonCount > 0,
    count: null,
    records: null,
    maneSelectPresent: null,
  };

  // Proteins: mark as available when gene has exons (heuristic; not definitive)
  const proteins: GeneRecord["proteins"] = {
    available: exonCount !== null && exonCount > 0,
    estimatedCount: null,
  };

  return {
    geneId,
    officialSymbol: entry.name,
    fullName: entry.description,
    organism: entry.organism.scientificname,
    taxonomyId: String(entry.organism.taxid),
    chromosome,
    cytogeneticLocation,
    genomicStart,
    genomicEnd,
    strand,
    geneType: null, // NOT in ESummary — requires EFetch XML (Phase 5.3)
    summary,
    aliases,
    sourceDatabase: "ncbi-gene",
    hgncId,
    ensemblId,
    omimId,
    geneRifCount,
    ncbiGeneUrl,
    ensemblUrl,
    omimUrl,
    transcripts,
    proteins,
    variants: { available: true },    // ClinVar likely has variants for any annotated gene
    expression: { available: true },   // GEO / Bgee likely has expression data
    pathways: { available: false },    // Phase 5.7+
    resolutionPath,
    linkEnrichment: linkStatus,
    ...(enrichmentNote ? { enrichmentNote } : {}),
  };
}
