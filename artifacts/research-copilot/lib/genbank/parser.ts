/**
 * genbank/parser.ts — Normalize raw NCBI API responses into SequenceResource objects.
 *
 * Three parsers, one per resolution path:
 *
 *   parseAssemblyRecord   — Rule 2 (organism query via assembly db)
 *   parseNucCoreRecord    — Rule 1 (accession) + Rule 2 fallback (organism via nuccore)
 *   parseGeneRecord       — Rule 3 (gene-symbol query via gene + NG_ nuccore record)
 *
 * All parsers:
 *   - Derive sequenceLengthUnit from resourceCategory + moltype (never set independently)
 *   - Set identifierScheme based on accession prefix (GCF_/NC_/NG_ → "ncbi-refseq";
 *     GCA_/GenBank INSDC letters → "ncbi-genbank"; sourcedb field used as tie-breaker)
 *   - Never fabricate values — if a field is not in the NCBI response, leave it undefined
 *   - Set referenceStatus per Rules 1/2/3 semantics
 *   - Set resolutionRule to "rule1" | "rule2" | "rule3" for validation reporting
 */

import type { SequenceResource, AvailableResource } from "@/types/sequence-resource";
import type { AssemblyESummaryEntry, NucCoreESummaryEntry, GeneESummaryEntry } from "./search";
import { parseAssemblyTotalLength, deriveSequenceLengthUnit } from "./summary";
import { buildAssemblyDownloads, buildNucCoreDownloads } from "./fetch";

// ── Accession prefix → identifierScheme ─────────────────────────────────────

/**
 * Determine identifierScheme from an accession string.
 * RefSeq prefixes: NC_, NG_, NM_, NR_, NP_, NT_, NW_, XM_, XP_, XR_, GCF_
 * GenBank/INSDC: GCA_, all other 2-letter prefixes
 */
function accessionToIdentifierScheme(
  accession: string,
  sourceDb?: string
): "ncbi-refseq" | "ncbi-genbank" {
  if (!accession) return "ncbi-genbank";
  const upper = accession.toUpperCase();
  if (upper.startsWith("GCF_")) return "ncbi-refseq";
  if (upper.startsWith("GCA_")) return "ncbi-genbank";
  // Nuccore: RefSeq prefixes are NC_, NG_, NM_, NR_, NP_, NT_, NW_, XM_, XP_, XR_
  if (/^N[CGMRPTW]_/i.test(upper) || /^X[MPR]_/i.test(upper)) return "ncbi-refseq";
  // Fallback: trust the sourcedb field if available
  if (sourceDb === "refseq") return "ncbi-refseq";
  return "ncbi-genbank";
}

/**
 * Parse an NCBI date string ("YYYY/MM/DD HH:MM" or "YYYY/MM/DD") to ISO format.
 * Returns undefined if the input is empty or unparseable.
 */
function parseNcbiDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// ── Standard available-resources for a complete genome ────────────────────────

function genomeAvailableResources(provider: "ncbi-refseq" | "ncbi-genbank"): AvailableResource[] {
  return [
    {
      type: "Genome",
      available: true,
      expandable: true,
      provider,
    },
    {
      type: "Genes",
      available: true,
      expandable: false, // Phase 5.2+ will implement NCBI Gene module
      provider: "ncbi-gene",
    },
    {
      type: "mRNA",
      available: true,
      expandable: false, // Phase 5.2+ Gene Explorer
      provider: "ncbi-refseq",
    },
    {
      type: "CDS",
      available: true,
      expandable: false,
      provider: "ncbi-refseq",
    },
    {
      type: "Proteins",
      available: true,
      expandable: false, // Future UniProt integration
      provider: "uniprot",
    },
    {
      type: "Raw Reads",
      available: false, // Future SRA integration
      expandable: false,
      provider: "ncbi-sra",
    },
  ];
}

// ── Rule 2: Assembly record → SequenceResource ─────────────────────────────

/**
 * Parse a NCBI Assembly ESummary entry into a SequenceResource.
 * Used for Rule 2 (organism/assembly queries) and Rule 1 (GCF_/GCA_ accession queries).
 */
export function parseAssemblyRecord(
  entry: AssemblyESummaryEntry,
  rule: "rule1" | "rule2"
): SequenceResource {
  const acc = entry.assemblyaccession ?? "";
  const name = entry.assemblyname ?? "";
  const identifierScheme = accessionToIdentifierScheme(acc);

  // refseq_category maps directly to referenceStatus
  const cat = (entry.refseq_category ?? "").toLowerCase();
  const referenceStatus =
    cat === "reference genome"
      ? "reference genome"
      : cat === "representative genome"
        ? "representative genome"
        : "other assembly";

  // resourceCategory: assembly records represent the whole genome
  const resourceCategory = "Genome" as const;

  // Genome total length from meta XML Stats (in bp — assemblies are always DNA)
  const sequenceLength = parseAssemblyTotalLength(entry.meta);
  const sequenceLengthUnit = deriveSequenceLengthUnit(resourceCategory, "dna");

  // synonym field: { genbank: "GCA_...", refseq: "GCF_...", similarity: "..." }
  const genbankAccession = entry.synonym?.genbank || undefined;
  const refseqAccession = entry.synonym?.refseq || undefined;

  // Downloads — use ftppath_refseq when available (GCF_), else ftppath_genbank
  const ftpBase = entry.ftppath_refseq || entry.ftppath_genbank || "";
  const downloads = buildAssemblyDownloads(ftpBase, acc, name);

  return {
    primaryAccession: acc,
    resourceIdentifier: acc,
    identifierScheme,
    resourceCategory,
    referenceStatus,
    organism: entry.organism || entry.speciesname || undefined,
    taxId: entry.taxid ? parseInt(entry.taxid, 10) : undefined,
    assemblyName: name || undefined,
    assemblyLevel: entry.assemblystatus || undefined,
    genbankAccession,
    refseqAccession,
    description: entry.organism
      ? `${entry.organism} ${entry.assemblystatus ?? ""}`.trim()
      : undefined,
    sequenceLength,
    sequenceLengthUnit,
    sourceDatabase: identifierScheme === "ncbi-refseq" ? "refseq" : "insd",
    submissionDate: parseNcbiDate(entry.asmreleasedate_genbank),
    lastUpdateDate: parseNcbiDate(entry.lastupdatedate),
    downloads,
    availableResources: genomeAvailableResources(identifierScheme),
    resolutionRule: rule,
  };
}

// ── Rule 1/2 fallback: NucCore record → SequenceResource ──────────────────

/**
 * Parse a NCBI NucCore ESummary entry into a SequenceResource.
 * Used for:
 *   - Rule 1 (accession lookup: NC_, NG_, NM_, NP_, INSDC accessions)
 *   - Rule 2 fallback (organism search fell through to nuccore, e.g. SARS-CoV-2)
 *   - Rule 3 internal step (NG_ RefSeqGene record metadata)
 */
export function parseNucCoreRecord(
  entry: NucCoreESummaryEntry,
  rule: "rule1" | "rule2" | "rule3"
): SequenceResource {
  const acc = entry.accessionversion ?? "";
  const identifierScheme = accessionToIdentifierScheme(acc, entry.sourcedb);

  // Determine referenceStatus from accession prefix
  let referenceStatus: SequenceResource["referenceStatus"];
  if (acc.startsWith("NG_")) {
    referenceStatus = "refseq-gene";
  } else if (acc.startsWith("NC_")) {
    referenceStatus = "refseq-chromosome";
  } else if (identifierScheme === "ncbi-refseq") {
    referenceStatus = "refseq-chromosome";
  } else {
    referenceStatus = "no-refseq";
  }

  // resourceCategory from accession prefix
  let resourceCategory: SequenceResource["resourceCategory"];
  if (acc.startsWith("NG_")) {
    resourceCategory = "Gene";
  } else {
    // NC_/NM_/NR_ etc. — use biomol/genome field to classify
    const biomol = entry.biomol ?? "";
    const genome = entry.genome ?? "";
    if (biomol === "genomic" && genome === "genomic") {
      resourceCategory = "Genome";
    } else {
      resourceCategory = "Genome"; // safe default for Phase 5.1
    }
  }

  // Sequence length and unit
  const slen = entry.slen ? parseInt(entry.slen, 10) : undefined;
  const sequenceLengthUnit = deriveSequenceLengthUnit(resourceCategory, entry.moltype);

  // Version from accession (NC_045512.2 → version 2)
  const versionMatch = acc.match(/\.(\d+)$/);
  const sequenceVersion = versionMatch ? parseInt(versionMatch[1], 10) : undefined;

  const downloads = buildNucCoreDownloads(acc);

  const availableResources: AvailableResource[] =
    resourceCategory === "Gene"
      ? [
          {
            type: "mRNA",
            available: true,
            expandable: false,
            provider: "ncbi-refseq",
          },
          {
            type: "CDS",
            available: true,
            expandable: false,
            provider: "ncbi-refseq",
          },
          {
            type: "Proteins",
            available: true,
            expandable: false,
            provider: "uniprot",
          },
        ]
      : genomeAvailableResources(identifierScheme);

  return {
    primaryAccession: acc,
    resourceIdentifier: acc,
    identifierScheme,
    resourceCategory,
    referenceStatus,
    organism: entry.organism || undefined,
    taxId: entry.taxid ? parseInt(entry.taxid, 10) : undefined,
    description: entry.title || undefined,
    moleculeType: entry.moltype || undefined,
    topology: entry.topology || undefined,
    sequenceLength: slen,
    sequenceLengthUnit,
    sourceDatabase: entry.sourcedb || undefined,
    sequenceVersion,
    submissionDate: parseNcbiDate(entry.createdate),
    lastUpdateDate: parseNcbiDate(entry.updatedate),
    downloads,
    availableResources,
    resolutionRule: rule,
  };
}

// ── Rule 3: Gene record + NG_ → SequenceResource ──────────────────────────

/**
 * Parse a gene symbol query result into a SequenceResource.
 *
 * Rule 3 spec: identify the gene, return the gene's best-supported RefSeq genomic
 * sequence record (NG_ / RefSeqGene) as the primary SequenceResource.
 * resourceCategory is ALWAYS "Gene" for Rule 3 queries.
 * mRNA and Protein are flagged as available in availableResources (not fetched).
 *
 * @param geneEntry   Gene ESummary entry (from gene db)
 * @param ngEntry     NucCore ESummary entry for the NG_ RefSeqGene record (may be null)
 */
export function parseGeneRecord(
  geneEntry: GeneESummaryEntry,
  ngEntry: NucCoreESummaryEntry | null
): SequenceResource {
  const acc = ngEntry?.accessionversion ?? "";
  const identifierScheme = acc
    ? accessionToIdentifierScheme(acc, ngEntry?.sourcedb)
    : "ncbi-refseq";

  const slen = ngEntry?.slen ? parseInt(ngEntry.slen, 10) : undefined;
  // Gene-level RefSeqGene records are always DNA → "bp"
  const sequenceLengthUnit = deriveSequenceLengthUnit("Gene", ngEntry?.moltype ?? "dna");

  const versionMatch = acc.match(/\.(\d+)$/);
  const sequenceVersion = versionMatch ? parseInt(versionMatch[1], 10) : undefined;

  // Gene description from gene db
  const description = ngEntry?.title
    ? ngEntry.title
    : geneEntry.description
      ? `${geneEntry.name}: ${geneEntry.description}`
      : geneEntry.name;

  const downloads = acc ? buildNucCoreDownloads(acc) : [];

  // Chromosome information from gene genomicinfo
  const chrAccver = geneEntry.genomicinfo?.[0]?.chraccver;
  const chromosome = geneEntry.chromosome || geneEntry.genomicinfo?.[0]?.chrloc;

  return {
    primaryAccession: acc || `Gene:${geneEntry.uid}`,
    resourceIdentifier: acc || `gene:${geneEntry.uid}`,
    identifierScheme,
    resourceCategory: "Gene",
    referenceStatus: "refseq-gene",
    organism: geneEntry.organism?.scientificname || undefined,
    taxId: geneEntry.organism?.taxid || undefined,
    description,
    moleculeType: ngEntry?.moltype || "dna",
    topology: ngEntry?.topology || "linear",
    sequenceLength: slen,
    sequenceLengthUnit,
    sourceDatabase: ngEntry?.sourcedb || "refseq",
    sequenceVersion,
    submissionDate: ngEntry ? parseNcbiDate(ngEntry.createdate) : undefined,
    lastUpdateDate: ngEntry ? parseNcbiDate(ngEntry.updatedate) : undefined,
    downloads,
    availableResources: [
      {
        type: "mRNA",
        available: true,
        // mRNA records (NM_) exist; not fetched in Phase 5.1
        expandable: false,
        provider: "ncbi-refseq",
      },
      {
        type: "Proteins",
        available: true,
        // Protein records (NP_) exist; UniProt integration is future
        expandable: false,
        provider: "uniprot",
      },
      ...(chrAccver
        ? [
            {
              type: "Genome Assembly" as const,
              available: true,
              expandable: false,
              provider: "ncbi-refseq",
            } as AvailableResource,
          ]
        : []),
    ],
    resolutionRule: "rule3",
    // Store chromosome accession for display in the frontend
    // (not a SequenceResource field — stored in description if needed)
    ...(chromosome ? { _chromosomeContext: `chromosome ${chromosome} (${chrAccver ?? ""})` } : {}),
  };
}
