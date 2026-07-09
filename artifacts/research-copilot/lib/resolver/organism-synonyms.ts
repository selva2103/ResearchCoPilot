/**
 * lib/resolver/organism-synonyms.ts — canonical organism synonym → TaxID lookup table.
 *
 * Phase R Bug 13: this is the single, authoritative table for common-name/synonym
 * organism recognition used by the resolver's explicit-organism detection (both
 * prefix — "mouse CD4" — and suffix — "Trp53 Mus musculus" — patterns). It is a
 * plain lookup table, not scattered inline regex/string matching.
 *
 * organism-prefix.ts derives its prefix regex list from this table so there is
 * exactly one place that knows which organisms are recognized and what their
 * TaxIDs/scientific names are.
 */

export interface OrganismSynonymEntry {
  taxId: number;
  name: string;
}

/**
 * Keys are lowercase synonyms (common names, adjectival forms, and scientific
 * names). Multiple keys may map to the same organism.
 */
export const ORGANISM_SYNONYMS: Record<string, OrganismSynonymEntry> = {
  human: { taxId: 9606, name: "Homo sapiens" },
  homo: { taxId: 9606, name: "Homo sapiens" },
  "homo sapiens": { taxId: 9606, name: "Homo sapiens" },

  mouse: { taxId: 10090, name: "Mus musculus" },
  murine: { taxId: 10090, name: "Mus musculus" },
  "mus musculus": { taxId: 10090, name: "Mus musculus" },

  rat: { taxId: 10116, name: "Rattus norvegicus" },
  "rattus norvegicus": { taxId: 10116, name: "Rattus norvegicus" },

  zebrafish: { taxId: 7955, name: "Danio rerio" },
  "danio rerio": { taxId: 7955, name: "Danio rerio" },

  fly: { taxId: 7227, name: "Drosophila melanogaster" },
  drosophila: { taxId: 7227, name: "Drosophila melanogaster" },
  "drosophila melanogaster": { taxId: 7227, name: "Drosophila melanogaster" },

  worm: { taxId: 6239, name: "Caenorhabditis elegans" },
  "c. elegans": { taxId: 6239, name: "Caenorhabditis elegans" },
  "c.elegans": { taxId: 6239, name: "Caenorhabditis elegans" },
  "caenorhabditis elegans": { taxId: 6239, name: "Caenorhabditis elegans" },

  yeast: { taxId: 4932, name: "Saccharomyces cerevisiae" },
  "saccharomyces cerevisiae": { taxId: 4932, name: "Saccharomyces cerevisiae" },

  arabidopsis: { taxId: 3702, name: "Arabidopsis thaliana" },
  "arabidopsis thaliana": { taxId: 3702, name: "Arabidopsis thaliana" },

  chicken: { taxId: 9031, name: "Gallus gallus" },
  "gallus gallus": { taxId: 9031, name: "Gallus gallus" },
};

/** Synonym keys sorted longest-first so multi-word names match before substrings. */
export const ORGANISM_SYNONYM_KEYS = Object.keys(ORGANISM_SYNONYMS).sort(
  (a, b) => b.length - a.length
);

/** Case-insensitive exact lookup. Returns null when the term isn't a known synonym. */
export function resolveOrganismSynonym(
  term: string
): OrganismSynonymEntry | null {
  return ORGANISM_SYNONYMS[term.trim().toLowerCase()] ?? null;
}
