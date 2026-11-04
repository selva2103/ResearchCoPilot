/**
 * lib/drug-target/links.ts - Phase 5.10C
 *
 * Pure builders for outbound links. Every link is built only from the identifiers passed in
 * (the searched gene or the listed drug), and every identifier is validated by a strict regex
 * before it is placed in a URL. An invalid or missing identifier produces no link.
 * URL patterns follow the links shown on the Open Targets Platform.
 */

export interface ExternalLink {
  label: string;
  href: string;
}

const ENSEMBL_GENE_RE = /^ENSG\d{11}$/;
export const UNIPROT_ACCESSION_RE =
  /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;
const GENE_SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const CHEMBL_RE = /^CHEMBL\d{1,12}$/;
const DRUGBANK_RE = /^DB\d{5}$/;
const PROBES_DRUGS_RE = /^PD\d{5,7}$/;
const CID_RE = /^\d{1,12}$/;

export function geneExternalLinks(input: {
  ensemblId: string | null | undefined;
  symbol?: string | null;
  uniprotId?: string | null;
}): ExternalLink[] {
  const links: ExternalLink[] = [];
  const { ensemblId, symbol, uniprotId } = input;
  if (ensemblId && ENSEMBL_GENE_RE.test(ensemblId)) {
    links.push({ label: "Ensembl", href: `https://identifiers.org/ensembl:${ensemblId}` });
  }
  if (uniprotId && UNIPROT_ACCESSION_RE.test(uniprotId)) {
    links.push({ label: "UniProt", href: `https://identifiers.org/uniprot:${uniprotId}` });
  }
  if (symbol && GENE_SYMBOL_RE.test(symbol)) {
    const s = encodeURIComponent(symbol);
    links.push({ label: "GeneCards", href: `https://www.genecards.org/card/${s}` });
    links.push({ label: "HGNC", href: `https://identifiers.org/hgnc.symbol:${s}` });
  }
  return links;
}

export function drugExternalLinks(input: {
  chemblId: string;
  drugbankIds?: readonly string[] | null;
  probesDrugsIds?: readonly string[] | null;
}): ExternalLink[] {
  const links: ExternalLink[] = [];
  if (CHEMBL_RE.test(input.chemblId)) {
    links.push({
      label: "ChEMBL",
      href: `https://www.ebi.ac.uk/chembl/compound_report_card/${input.chemblId}/`,
    });
  }
  const seen = new Set<string>();
  for (const id of input.drugbankIds ?? []) {
    if (!DRUGBANK_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    links.push({ label: `DrugBank ${id}`, href: `https://identifiers.org/drugbank:${id}` });
  }
  for (const id of input.probesDrugsIds ?? []) {
    if (!PROBES_DRUGS_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    links.push({ label: `Probes&Drugs ${id}`, href: `https://www.probes-drugs.org/compound/${id}` });
  }
  return links;
}

/** Direct PubChem REST URL for the computed 3D conformer SDF of one CID. */
export function pubchemSdf3dUrl(cid: string | null | undefined): string | null {
  if (!cid || !CID_RE.test(cid)) return null;
  return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
}

/** Pure: picks validated DrugBank and Probes&Drugs IDs out of Open Targets crossReferences. */
export function parseCrossReferences(raw: unknown): { drugbankIds: string[]; probesDrugsIds: string[] } {
  const drugbank = new Set<string>();
  const probes = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const source = typeof rec.source === "string" ? rec.source.toLowerCase() : "";
      const ids = Array.isArray(rec.ids) ? rec.ids : [];
      for (const id of ids) {
        if (typeof id !== "string") continue;
        if (source === "drugbank" && DRUGBANK_RE.test(id)) drugbank.add(id);
        else if (source === "probes&drugs" && PROBES_DRUGS_RE.test(id)) probes.add(id);
      }
    }
  }
  return { drugbankIds: Array.from(drugbank), probesDrugsIds: Array.from(probes) };
}
