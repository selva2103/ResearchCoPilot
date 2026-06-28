/**
 * genbank/index.ts — Public API for the Sequence Foundation module.
 *
 * Returns ModuleResult<SequenceResource> for any query string.
 *
 * Resolution pipeline:
 *
 *   classifyQuery(query)
 *     → "gene-symbol"  → Rule 3: gene db → elink → NG_ nuccore record
 *     → "accession"    → Rule 1: nuccore or assembly direct lookup
 *     → "organism"     → Rule 2: assembly db → sort by refseq_category
 *                                → fallback to nuccore if no reference/representative found
 *
 * Database selection rationale (from pre-code live API inspection):
 *
 *   Gene symbols (TP53, BRCA1):
 *     gene db → ESummary (gene metadata, chromosome context)
 *     elink gene→nuccore (linkname=gene_nuccore_refseqgene) → NG_ UIDs
 *     nuccore ESummary → sequence metadata
 *
 *   Organisms (Mycobacterium tuberculosis H37Rv, Arabidopsis thaliana):
 *     assembly db ESearch retmax=200 → ESummary batch → selectBestAssembly (Rule 2 sort)
 *     If refseq_category filter yields nothing in first 200: fetch remaining (total up to 500)
 *     Fallback to nuccore when assembly db has no curated reference/representative
 *     (confirmed for SARS-CoV-2: 12,472 individual isolate assemblies, all refseq_cat="na")
 *
 *   Accessions (NC_045512, GCF_000195955.2):
 *     Direct lookup, Rule 1 (RefSeq preferred)
 *
 * NCBI rate limit: the sequence module uses sequential NCBI calls with 350ms delays.
 * The module runs on initial load only (not on PubMed/GEO Load More).
 *
 * This module does NOT modify: PubMed, GEO, pagination, rate limiter, Python, AI.
 */

import type { SequenceResource } from "@/types/sequence-resource";
import type { ModuleResult } from "@/types/module-result";
import { buildModuleResult, toModuleError } from "@/types/module-result";

import {
  classifyQuery,
  searchGene,
  fetchGeneSummary,
  getRefSeqGeneNuccoreIds,
  searchAssemblies,
  fetchAssemblySummaries,
  fetchNucCoreSummaries,
  searchNucCoreRefSeq,
  searchNucCoreByAccession,
  sleep,
  RATE_DELAY_MS,
} from "./search";

import { selectBestAssembly, selectBestNucCore } from "./summary";
import { parseAssemblyRecord, parseNucCoreRecord, parseGeneRecord } from "./parser";

// ── Rule 3: Gene-symbol resolution ───────────────────────────────────────────

async function resolveGeneSymbol(
  geneSymbol: string
): Promise<SequenceResource[]> {
  // Step 1: gene ESearch → gene_id
  const { geneId } = await searchGene(geneSymbol);

  // Step 2: gene ESummary → gene metadata
  await sleep(RATE_DELAY_MS);
  const geneEntry = await fetchGeneSummary(geneId);

  // Step 3: elink gene → nuccore (RefSeqGene) → NG_ UIDs
  await sleep(RATE_DELAY_MS);
  const { nuccoreIds } = await getRefSeqGeneNuccoreIds(geneId);

  let ngEntry = null;
  if (nuccoreIds.length > 0) {
    // Step 4: nuccore ESummary for NG_ record(s)
    await sleep(RATE_DELAY_MS);
    const entries = await fetchNucCoreSummaries(nuccoreIds.slice(0, 3));
    // Prefer the one with accession starting NG_ (RefSeqGene)
    const ngEntries = entries.filter((e) => e.accessionversion?.startsWith("NG_"));
    ngEntry = ngEntries.length > 0 ? ngEntries[0] : entries[0] ?? null;
  }

  const resource = parseGeneRecord(geneEntry, ngEntry);
  return [resource];
}

// ── Rule 2: Organism/assembly resolution ─────────────────────────────────────

async function resolveOrganism(
  organism: string
): Promise<SequenceResource[]> {
  // Step 1: assembly ESearch (retmax=200 — needed because NCBI sorts newest-first
  // and the reference genome may be at a low position for well-studied organisms)
  const { ids: firstBatch, totalCount } = await searchAssemblies(organism, 200);

  let allEntries = await fetchAssemblySummaries(firstBatch);
  await sleep(RATE_DELAY_MS);

  // Check if we found a reference/representative genome in the first 200
  const hasRefRepInFirst = allEntries.some((e) => {
    const cat = (e.refseq_category ?? "").toLowerCase();
    return cat === "reference genome" || cat === "representative genome";
  });

  // If not found and there are more results, fetch one additional batch (up to 300 more)
  if (!hasRefRepInFirst && totalCount > 200) {
    await sleep(RATE_DELAY_MS);
    const { ids: secondBatch } = await searchAssemblies(organism, 500);
    const remaining = secondBatch.slice(200, 500);
    if (remaining.length > 0) {
      const moreEntries = await fetchAssemblySummaries(remaining);
      allEntries = [...allEntries, ...moreEntries];
    }
    await sleep(RATE_DELAY_MS);
  }

  const selection = selectBestAssembly(allEntries);

  if (!selection) {
    // No assembly found → fall back to nuccore
    return resolveOrganismViaNucCore(organism);
  }

  const { best, alternates: _alternates } = selection;
  const refCat = (best.refseq_category ?? "").toLowerCase();

  if (refCat === "na" || (!best.ftppath_refseq && !best.ftppath_genbank)) {
    // Found assemblies but none are flagged reference/representative →
    // fallback to nuccore for viral or poorly-assembled organisms
    const nucCoreResult = await resolveOrganismViaNucCore(organism);
    if (nucCoreResult.length > 0) return nucCoreResult;
    // Still return the best assembly we found
  }

  const resource = parseAssemblyRecord(best, "rule2");
  return [resource];
}

async function resolveOrganismViaNucCore(
  organism: string
): Promise<SequenceResource[]> {
  const { ids } = await searchNucCoreRefSeq(organism);
  if (ids.length === 0) return [];
  const entries = await fetchNucCoreSummaries(ids.slice(0, 5));
  const best = selectBestNucCore(entries);
  if (!best) return [];
  return [parseNucCoreRecord(best, "rule2")];
}

// ── Rule 1: Accession resolution ──────────────────────────────────────────────

async function resolveAccession(
  accession: string
): Promise<SequenceResource[]> {
  const upper = accession.toUpperCase();

  // Assembly accession (GCF_/GCA_)
  if (upper.startsWith("GCF_") || upper.startsWith("GCA_")) {
    const { ids } = await searchAssemblies(accession, 5);
    if (ids.length > 0) {
      const entries = await fetchAssemblySummaries(ids.slice(0, 3));
      const best = selectBestAssembly(entries);
      if (best) {
        return [parseAssemblyRecord(best.best, "rule1")];
      }
    }
    return [];
  }

  // NucCore accession (NC_, NG_, NM_, or INSDC)
  const { ids } = await searchNucCoreByAccession(accession);
  if (ids.length === 0) return [];
  const entries = await fetchNucCoreSummaries(ids.slice(0, 5));
  const best = selectBestNucCore(entries);
  if (!best) return [];
  return [parseNucCoreRecord(best, "rule1")];
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Search for sequence resources for the given query string.
 *
 * Classifies the query and routes to the appropriate resolution path (Rule 1/2/3).
 * Returns ModuleResult<SequenceResource> following the same contract as searchPubMed
 * and searchGeoDatasets.
 *
 * Pagination: Phase 5.1 returns up to 5 curated SequenceResources (not a paginated list).
 * The sequence module always runs on the initial load and is NOT triggered on Load More.
 */
export async function searchSequenceResources(
  query: string
): Promise<ModuleResult<SequenceResource>> {
  const startedAt = performance.now();

  const queryType = classifyQuery(query.trim());

  try {
    let resources: SequenceResource[];

    if (queryType === "gene-symbol") {
      resources = await resolveGeneSymbol(query.trim());
    } else if (queryType === "accession") {
      resources = await resolveAccession(query.trim());
    } else {
      resources = await resolveOrganism(query.trim());
    }

    if (resources.length === 0) {
      return buildModuleResult({
        module: "genbank",
        status: "empty",
        data: [],
        error: null,
        startedAt,
      });
    }

    return buildModuleResult({
      module: "genbank",
      status: "success",
      data: resources,
      error: null,
      startedAt,
    });
  } catch (err) {
    // Distinguish error types for Step 9 error handling
    const message = err instanceof Error ? err.message : String(err);

    let code = "SEQUENCE_ERROR";
    if (message.includes("HTTP 429") || message.toLowerCase().includes("rate")) {
      code = "RATE_LIMITED";
    } else if (message.includes("HTTP 5")) {
      code = "NCBI_UNAVAILABLE";
    } else if (message.includes("No gene found") || message.includes("No assembly")) {
      code = "NO_SEQUENCE_FOUND";
    } else if (message.includes("parse") || message.includes("JSON")) {
      code = "PARSER_ERROR";
    } else if (message.includes("fetch") || message.includes("network")) {
      code = "NETWORK_ERROR";
    }

    return buildModuleResult({
      module: "genbank",
      status: "error",
      data: [],
      error: toModuleError(code, err),
      startedAt,
    });
  }
}

export type { SequenceResource } from "@/types/sequence-resource";
