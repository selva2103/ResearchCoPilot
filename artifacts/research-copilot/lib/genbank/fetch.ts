/**
 * genbank/fetch.ts — Download URL construction and verification.
 *
 * Phase 5.1 supported download formats:
 *   - Genome FASTA       (_genomic.fna.gz)
 *   - GenBank Flat File  (_genomic.gbff.gz)
 *   - Feature Table      (_feature_table.txt.gz)
 *
 * NOT in Phase 5.1: Protein FASTA, Gene FASTA, CDS FASTA.
 *
 * Download URL patterns (verified via HEAD requests during pre-code inspection):
 *
 * For assembly records (from assembly ESummary ftppath_refseq):
 *   Base: ftp://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/000/195/955/GCF_000195955.2_ASM19595v2
 *   FASTA:    {base}/{acc}_{name}_genomic.fna.gz           → HTTP 200 ✓
 *   GBK:      {base}/{acc}_{name}_genomic.gbff.gz          → HTTP 200 ✓
 *   Features: {base}/{acc}_{name}_feature_table.txt.gz     → HTTP 200 ✓
 *
 * For nuccore records (NC_ accessions, e.g. SARS-CoV-2 NC_045512.2):
 *   FASTA:    eutils efetch with rettype=fasta
 *   GBK:      eutils efetch with rettype=gb
 *   Features: eutils efetch with rettype=ft
 */

import type { SequenceDownload } from "@/types/sequence-resource";

const NCBI_FTP_HTTPS = "https://ftp.ncbi.nlm.nih.gov";
const NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

/**
 * Convert an NCBI FTP base path (ftp://...) to an HTTPS URL.
 * NCBI FTP paths use ftp:// scheme; HTTPS mirrors exist at the same path.
 */
function ftpToHttps(ftpPath: string): string {
  return ftpPath.replace(/^ftp:\/\/ftp\.ncbi\.nlm\.nih\.gov/, NCBI_FTP_HTTPS);
}

/**
 * Build download URLs for an assembly record using ftppath_refseq.
 *
 * URL pattern (confirmed via live HTTP 200 checks during pre-code inspection):
 *   {ftppath_refseq_https}/{assemblyAccession}_{assemblyName}_{suffix}
 *
 * @param ftpBasePath  The ftppath_refseq value from assembly ESummary (ftp://...)
 * @param acc          assemblyaccession, e.g. "GCF_000195955.2"
 * @param name         assemblyname, e.g. "ASM19595v2"
 */
export function buildAssemblyDownloads(
  ftpBasePath: string,
  acc: string,
  name: string
): SequenceDownload[] {
  if (!ftpBasePath || !acc || !name) return [];

  const httpsBase = ftpToHttps(ftpBasePath);
  const filePrefix = `${acc}_${name}`;

  return [
    {
      name: "Genome FASTA",
      format: "fasta",
      url: `${httpsBase}/${filePrefix}_genomic.fna.gz`,
      verified: true, // Pattern confirmed via live HEAD requests in pre-code inspection
    },
    {
      name: "GenBank Flat File",
      format: "genbank",
      url: `${httpsBase}/${filePrefix}_genomic.gbff.gz`,
      verified: true,
    },
    {
      name: "Feature Table",
      format: "feature-table",
      url: `${httpsBase}/${filePrefix}_feature_table.txt.gz`,
      verified: true,
    },
  ];
}

/**
 * Build download URLs for a nuccore record (e.g. NC_045512.2, NG_017013.2).
 * Uses NCBI EFetch with rettype parameters — no FTP path needed.
 *
 * Note: These URLs serve the sequence content directly (not gzipped).
 * For large genomes this may be slow; for small viral/gene records it is fine.
 * Phase 5.2+ may substitute FTP-based downloads for large assemblies.
 */
export function buildNucCoreDownloads(accession: string): SequenceDownload[] {
  if (!accession) return [];

  const base = `${NCBI_EFETCH}?db=nuccore&id=${encodeURIComponent(accession)}`;

  return [
    {
      name: "Genome FASTA",
      format: "fasta",
      url: `${base}&rettype=fasta&retmode=text`,
      verified: false, // URL pattern is correct per NCBI API docs; not HEAD-checked
    },
    {
      name: "GenBank Flat File",
      format: "genbank",
      url: `${base}&rettype=gb&retmode=text`,
      verified: false,
    },
    {
      name: "Feature Table",
      format: "feature-table",
      url: `${base}&rettype=ft&retmode=text`,
      verified: false,
    },
  ];
}
