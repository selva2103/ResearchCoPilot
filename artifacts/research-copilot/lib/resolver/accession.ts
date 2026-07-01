/**
 * lib/resolver/accession.ts — Accession Pattern Classifier
 *
 * Step 2 concrete detection rules for Accession, Assembly, Chromosome, Transcript,
 * Protein, and Genome (NG_) query types.
 *
 * Resolution rules are pure regex — zero NCBI API calls — giving instant,
 * deterministic results at confidence = 0.98.
 *
 * ── NCBI Accession Prefix Reference (verified against NCBI documentation) ──────
 *
 * RefSeq prefixes (format: PREFIX_digits.version):
 *   NC_  chromosome / complete genomic molecule (curated, reference-quality)
 *   NT_  chromosome contig (derived from clone-based assembly)
 *   NW_  scaffold (whole-genome shotgun sequence)
 *   NZ_  complete genome (WGS, may be multi-component)
 *   NG_  genomic region (RefSeqGene — gene-centric locus)
 *   NM_  protein-coding mRNA transcript
 *   NR_  non-coding RNA transcript
 *   XM_  predicted mRNA (GNOMON annotation)
 *   XR_  predicted non-coding RNA (GNOMON)
 *   NP_  protein derived from NM_ transcript
 *   XP_  predicted protein derived from XM_
 *   YP_  protein from complete genome (no mRNA counterpart — viral / bacterial)
 *   WP_  non-redundant protein (identical protein merged across organisms)
 *   AP_  protein (DDBJ annotation)
 *
 * Assembly accessions (format: GCF_/GCA_ + 9 digits + optional .version):
 *   GCF_  RefSeq Assembly (may carry "reference genome" / "representative" tag)
 *   GCA_  GenBank Assembly (all INSDC submissions)
 *
 * SRA accessions (no underscore separator; digits only after prefix):
 *   SRR / ERR / DRR  sequencing runs        (NCBI / EBI / DDBJ)
 *   SRS / ERS / DRS  biological samples
 *   SRX / ERX / DRX  sequencing experiments
 *   SRP / ERP / DRP  projects / studies
 *
 * Traditional INSDC accessions (GenBank / EMBL / DDBJ format):
 *   1 letter + 5 digits  (old RNA sequences, e.g. U12345)
 *   2 letters + 6 digits (standard GenBank, e.g. AY123456)
 *   4 letters + 8 digits (WGS master / contig, e.g. ABCD12345678)
 */

import type { QueryResolution, QueryType } from "@/types/query-resolution";
import { toConfidenceTier } from "@/types/query-resolution";

// ─── Regex patterns ───────────────────────────────────────────────────────────

// Chromosome-level RefSeq (complete genomic molecules)
const RE_CHROMOSOME = /^(NC|NT|NW|NZ)_\d{6,}(\.\d+)?$/i;

// Gene-region RefSeq (RefSeqGene locus)
const RE_GENE_REGION = /^NG_\d{6,}(\.\d+)?$/i;

// Transcript RefSeq
const RE_TRANSCRIPT = /^(NM|NR|XM|XR)_\d{6,}(\.\d+)?$/i;

// Protein RefSeq
const RE_PROTEIN = /^(NP|XP|YP|WP|AP)_\d{6,}(\.\d+)?$/i;

// RefSeq Assembly
const RE_REFSEQ_ASSEMBLY = /^GCF_\d{9,}(\.\d+)?$/i;

// GenBank Assembly
const RE_GENBANK_ASSEMBLY = /^GCA_\d{9,}(\.\d+)?$/i;

// SRA — NCBI
const RE_NCBI_SRA = /^(SRR|SRS|SRX|SRP|SRA)\d+$/i;

// SRA — EBI
const RE_EBI_SRA = /^(ERR|ERS|ERX|ERP)\d+$/i;

// SRA — DDBJ
const RE_DDBJ_SRA = /^(DRR|DRS|DRX|DRP)\d+$/i;

// Traditional INSDC (1–2 letter prefix + 5–6 digits, or 4-letter WGS + 8+ digits)
const RE_INSDC = /^([A-Z]{1,2}\d{5,6}|[A-Z]{4}\d{8,})(\.\d+)?$/;

// ─── Classification ───────────────────────────────────────────────────────────

interface AccessionClassification {
  queryType: QueryType;
  identifierScheme: string;
  matchedProvider: string;
  /** Human-readable accession type label for the frontend. */
  label: string;
}

function classifyPrefix(q: string): AccessionClassification | null {
  if (RE_CHROMOSOME.test(q))
    return { queryType: "Chromosome", identifierScheme: "ncbi-refseq", matchedProvider: "NCBI RefSeq", label: "RefSeq Chromosome" };

  if (RE_GENE_REGION.test(q))
    return { queryType: "Genome", identifierScheme: "ncbi-refseq", matchedProvider: "NCBI RefSeq", label: "RefSeqGene Region" };

  if (RE_TRANSCRIPT.test(q))
    return { queryType: "Transcript", identifierScheme: "ncbi-refseq", matchedProvider: "NCBI RefSeq", label: "RefSeq Transcript" };

  if (RE_PROTEIN.test(q))
    return { queryType: "Protein", identifierScheme: "ncbi-refseq", matchedProvider: "NCBI RefSeq", label: "RefSeq Protein" };

  if (RE_REFSEQ_ASSEMBLY.test(q))
    return { queryType: "Assembly", identifierScheme: "ncbi-refseq", matchedProvider: "NCBI RefSeq (Assembly)", label: "RefSeq Assembly" };

  if (RE_GENBANK_ASSEMBLY.test(q))
    return { queryType: "Assembly", identifierScheme: "ncbi-genbank", matchedProvider: "NCBI GenBank (Assembly)", label: "GenBank Assembly" };

  if (RE_NCBI_SRA.test(q))
    return { queryType: "Accession", identifierScheme: "ncbi-sra", matchedProvider: "NCBI SRA", label: "NCBI SRA" };

  if (RE_EBI_SRA.test(q))
    return { queryType: "Accession", identifierScheme: "ebi-sra", matchedProvider: "EBI SRA", label: "EBI SRA" };

  if (RE_DDBJ_SRA.test(q))
    return { queryType: "Accession", identifierScheme: "ddbj-sra", matchedProvider: "DDBJ SRA", label: "DDBJ SRA" };

  if (RE_INSDC.test(q))
    return { queryType: "Accession", identifierScheme: "ncbi-genbank", matchedProvider: "NCBI GenBank", label: "INSDC Accession" };

  return null;
}

/**
 * Attempt to classify the query as a NCBI accession.
 *
 * Returns a partial QueryResolution (without originalQuery) if the query
 * matches a known prefix pattern, or null if it does not.
 *
 * Confidence is always 0.98 — pattern matching is unambiguous by definition.
 * No NCBI API calls are made.
 */
export function classifyAccession(
  query: string
): Omit<QueryResolution, "originalQuery" | "relationships"> | null {
  const q = query.trim();
  const cls = classifyPrefix(q);
  if (!cls) return null;

  // Extract the prefix portion for the resolutionPath label
  const prefix = q.match(/^([A-Z]+_?)/i)?.[1]?.toUpperCase() ?? q;

  return {
    normalizedQuery: q,
    queryType: cls.queryType,
    confidence: 0.98,
    confidenceTier: toConfidenceTier(0.98),
    matchedProvider: cls.matchedProvider,
    primaryIdentifier: q,
    identifierScheme: cls.identifierScheme,
    scientificName: undefined,
    organism: undefined,
    taxonomyId: undefined,
    resolutionPath: `accession-pattern:${prefix}`,
    notes: `Recognized as ${cls.label} by accession prefix pattern (no API call required).`,
  };
}

// ─── Re-export for use in the resolver index ──────────────────────────────────

export { RE_CHROMOSOME, RE_TRANSCRIPT, RE_PROTEIN, RE_REFSEQ_ASSEMBLY, RE_GENBANK_ASSEMBLY };
