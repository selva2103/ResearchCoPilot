import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import { searchGeoDatasets } from "@/lib/geo";
import { searchSequenceResources } from "@/lib/genbank";
import { searchGeneExplorer } from "@/lib/gene";
import { GENE_RATE_DELAY_MS, sleep } from "@/lib/gene/search";
import { searchTranscripts } from "@/lib/transcript";
import { resolveQuery } from "@/lib/resolver";
import type { Paper } from "@/types/paper";
import type { Dataset } from "@/types/dataset";
import type { SequenceResource } from "@/types/sequence-resource";
import type { GeneRecord } from "@/types/gene-record";
import type { QueryResolution } from "@/types/query-resolution";
import { toConfidenceTier } from "@/types/query-resolution";
import type { NormalizedQuery } from "@/types/normalized-query";

/**
 * Gene Explorer accepts a resolved gene identifier via a QueryResolution-shaped
 * option object (its input shape is unchanged from before Phase R — see
 * INTEGRATION 1 in the Phase R spec). This adapter derives that shape from the
 * orchestrator's single NormalizedQuery so Gene Explorer never needs to know
 * about NormalizedQuery directly.
 */
function buildGeneAdapterResolution(nq: NormalizedQuery): QueryResolution | null {
  if (nq.gene) {
    return {
      originalQuery: nq.rawQuery,
      normalizedQuery: nq.gene.symbol,
      queryType: "Gene",
      confidence: nq.confidence,
      confidenceTier: toConfidenceTier(nq.confidence),
      primaryIdentifier: nq.gene.geneId ?? undefined,
      identifierScheme: nq.gene.geneId ? "ncbi-gene" : undefined,
      organism: nq.organism?.name ?? nq.gene.organismMatched ?? undefined,
      taxonomyId: nq.organism?.taxId ?? undefined,
      relationships: {},
    };
  }
  if (nq.organism || nq.disease || nq.protein) {
    // No gene identified, but a different entity type was — gate Gene Explorer
    // off in the same way a non-gene HIGH-confidence QueryResolution used to.
    return {
      originalQuery: nq.rawQuery,
      normalizedQuery: nq.rawQuery,
      queryType: nq.organism ? "Organism" : nq.disease ? "Disease" : "Accession",
      confidence: nq.confidence,
      confidenceTier: toConfidenceTier(nq.confidence),
      relationships: {},
    };
  }
  return null;
}

/**
 * Derive the effective query string passed to PubMed/GEO/Sequence Foundation
 * from a NormalizedQuery. Mirrors the old HIGH-confidence-tier auto-apply rule
 * (>= 0.90): below that threshold, the raw query is used unchanged.
 */
function deriveEffectiveQuery(nq: NormalizedQuery, rawQuery: string): string {
  if (nq.confidence < 0.9) return rawQuery;
  if (nq.gene) return nq.gene.symbol;
  if (nq.disease) return nq.disease.name;
  if (nq.organism) return nq.organism.name;
  return rawQuery;
}

// TODO: SRA integration         — NCBI SRA for raw sequencing runs linked to GSE accessions
// TODO: ArrayExpress integration — EBI ArrayExpress for European transcriptomics datasets
// TODO: TCGA integration        — NCI GDC portal for cancer genomics cohort data
// TODO: Europe PMC integration  — full-text search to supplement PubMed coverage
// TODO: AI reasoning layer      — use OpenAI GPT-4 to generate landscape, emergingAreas,
//                                  researchGaps, and projects from query + paper abstracts
// TODO: Keyword extraction      — cluster PubMed MeSH terms + GEO metadata for topics
// TODO: RAG support             — retrieve semantically similar papers + datasets
// TODO: Vector embeddings       — embed abstracts + dataset summaries for similarity search

/**
 * Structured pagination metadata returned per module in the API response.
 * Mirrors the pagination fields in ModuleResult<T> but with required fields
 * for client consumption (no optional ambiguity in the API contract).
 */
interface PaginationMeta {
  /** Total records in the upstream database matching this query */
  totalCount: number;
  /** Records per page */
  pageSize: number;
  /** Zero-based offset of the first record on this page */
  offset: number;
  /** Whether more pages are available */
  hasMore: boolean;
  /**
   * Offset to use for the next Load More request.
   * null when hasMore is false.
   */
  nextOffset: number | null;
  /** 1-based current page number */
  currentPage: number;
  /** Total pageable pages (may be less than totalCount/pageSize if upstream ceiling applies) */
  totalPages: number;
  /**
   * True when hasMore=false because of the NCBI ESearch ceiling (retstart+retmax≈9999),
   * not because results are genuinely exhausted.
   * The UI must show a different message in this case — not "you've seen everything."
   */
  hitUpstreamLimit: boolean;
}

interface AnalyzeRequest {
  query: string;
  /**
   * Records per page. Default: 10. Applies to whichever module(s) are being fetched.
   * The same limit is used for both PubMed and GEO to keep the UI consistent.
   */
  limit?: number;
  /**
   * Zero-based offset for PubMed results (retstart).
   * Default: 0. When > 0 and datasetsOffset = 0: only PubMed is fetched (saves NCBI calls).
   */
  papersOffset?: number;
  /**
   * Zero-based offset for GEO results (retstart).
   * Default: 0. When > 0 and papersOffset = 0: only GEO is fetched (saves NCBI calls).
   */
  datasetsOffset?: number;
  /**
   * Zero-based offset for Gene Explorer results.
   * Default: 0. When > 0 and both other offsets = 0: only Gene Explorer is fetched.
   */
  genesOffset?: number;
  /**
   * The effective (normalized) query that was used for the initial load.
   * Passed by the frontend on Load More requests so the server uses the same
   * query that produced page 1 — avoids re-running the biological resolver on
   * every pagination click.
   *
   * - Populated by the frontend when the initial load returned a HIGH-confidence
   *   resolution with a different normalizedQuery.
   * - Absent on the initial load (server computes effectiveQuery itself).
   * - Absent when the initial resolution was MEDIUM/LOW (normalizedQuery was not
   *   auto-applied, so originalQuery is still the effective query).
   */
  resolvedQuery?: string;
}

interface AnalyzeResponse {
  /**
   * AI-generated content. Only included in the initial load response (both offsets = 0).
   * On Load More requests (one offset > 0) these fields are empty arrays to keep the
   * response lightweight — the frontend ignores them on pagination requests.
   */
  landscape: string[];
  emergingAreas: string[];
  researchGaps: string[];
  projects: string[];

  /** PubMed papers for this page. Empty array when PubMed was not fetched. */
  papers: Paper[];
  /** Pagination metadata for papers. null when PubMed was not fetched on this request. */
  papersMeta: PaginationMeta | null;
  /** Set when PubMed fetch failed — distinct from a genuine zero-result query */
  papersError?: string;

  /** GEO datasets for this page. Empty array when GEO was not fetched. */
  datasets: Dataset[];
  /** Pagination metadata for datasets. null when GEO was not fetched on this request. */
  datasetsMeta: PaginationMeta | null;
  /** Set when GEO fetch failed */
  datasetsError?: string;

  /**
   * Sequence resources for this query. Empty array on Load More requests —
   * the sequence module runs on the initial load only (Phase 5.1, no pagination).
   */
  sequences: SequenceResource[];
  /** Set when sequence fetch failed */
  sequencesError?: string;

  /**
   * Gene records for this page. Empty array on non-gene Load More requests.
   * Gene Explorer runs on the initial load and on gene pagination (genesOffset > 0).
   */
  genes: GeneRecord[];
  /** Pagination metadata for genes. null when Gene Explorer was not fetched. */
  genesMeta: PaginationMeta | null;
  /** Set when Gene Explorer fetch failed */
  genesError?: string;

  /**
   * Structured result of the Biological Query Resolution Layer (Phase R).
   * Populated on the initial load only — null on Load More requests.
   *
   * NormalizedQuery extracts ALL recognized entities from the query (gene,
   * organism, disease, protein/accession) rather than a single classification —
   * see types/normalized-query.ts. effectiveQuery is auto-derived from the
   * resolved entity only when confidence >= 0.90; below that, the raw query
   * is used unchanged for downstream modules.
   */
  resolution: NormalizedQuery | null;

  /**
   * The query string that was actually passed to PubMed, GEO, and Sequence Foundation.
   * Equals normalizedQuery when resolution.confidenceTier is "high" and normalizedQuery
   * differs from originalQuery; equals originalQuery otherwise.
   *
   * The frontend must pass this back as resolvedQuery on every Load More request so that
   * pagination fetches pages 2+ using the same query that was used for page 1.
   *
   * Included on all responses (initial and Load More).
   */
  effectiveQuery: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as AnalyzeRequest;

  if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
    return NextResponse.json(
      { error: "query is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const query = body.query.trim();
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 10;
  const papersOffset =
    typeof body.papersOffset === "number" && body.papersOffset >= 0
      ? body.papersOffset
      : 0;
  const datasetsOffset =
    typeof body.datasetsOffset === "number" && body.datasetsOffset >= 0
      ? body.datasetsOffset
      : 0;
  const genesOffset =
    typeof body.genesOffset === "number" && body.genesOffset >= 0
      ? body.genesOffset
      : 0;

  // ── Smart module selection ────────────────────────────────────────────────
  // On the initial load (all offsets = 0) we run all modules sequentially to respect
  // the shared 3 req/s NCBI rate limit (concurrent calls → HTTP 429).
  //
  // On pagination:
  //   Load More Papers   (papersOffset > 0, others = 0) → run only PubMed
  //   Load More Datasets (datasetsOffset > 0, others = 0) → run only GEO
  //   Load More Genes    (genesOffset > 0, others = 0) → run only Gene Explorer
  //   Multiple > 0 (not yet used by frontend, but supported) → run relevant modules
  //
  // Never run modules concurrently — sequential execution respects NCBI rate limits.

  const isInitialLoad = papersOffset === 0 && datasetsOffset === 0 && genesOffset === 0;
  const onlyPapers = papersOffset > 0 && datasetsOffset === 0 && genesOffset === 0;
  const onlyDatasets = datasetsOffset > 0 && papersOffset === 0 && genesOffset === 0;
  const onlyGenes = genesOffset > 0 && papersOffset === 0 && datasetsOffset === 0;

  const runPubMed = !onlyDatasets && !onlyGenes;
  const runGeo = !onlyPapers && !onlyGenes;
  const runGenes = isInitialLoad || onlyGenes;

  // ── Biological Query Resolution (Step 5 — initial load only) ─────────────
  // Runs before any scientific module to determine the canonical biological
  // entity the user is searching for.
  //
  // Confidence-tier gating:
  //   HIGH   (≥ 0.90): effectiveQuery = normalizedQuery (auto-applied)
  //   MEDIUM (0.60–0.89): effectiveQuery = originalQuery (user must accept suggestion)
  //   LOW    (< 0.60): effectiveQuery = originalQuery (Unknown, no suggestion)
  //
  // Load More: the frontend passes resolvedQuery back so we don't re-run the
  // resolver and so pagination stays aligned with the initial-load query.
  let resolution: NormalizedQuery | null = null;
  let geneAdapterResolution: QueryResolution | null = null;
  let effectiveQuery: string;

  if (isInitialLoad) {
    resolution = await resolveQuery(query);
    geneAdapterResolution = buildGeneAdapterResolution(resolution);
    effectiveQuery = deriveEffectiveQuery(resolution, query);
  } else {
    // Load More: use the resolvedQuery the frontend passes back (from initial response).
    // Falls back to originalQuery if not provided or malformed (backward compatibility).
    const rq = typeof body.resolvedQuery === "string" ? body.resolvedQuery.trim() : "";
    effectiveQuery = rq || query;
  }

  let papers: Paper[] = [];
  let papersMeta: PaginationMeta | null = null;
  let papersError: string | undefined;

  let datasets: Dataset[] = [];
  let datasetsMeta: PaginationMeta | null = null;
  let datasetsError: string | undefined;

  // ── Run PubMed ─────────────────────────────────────────────────────────────
  if (!onlyDatasets && runPubMed) {
    const pubmedResult = await searchPubMed(effectiveQuery, {
      limit,
      offset: papersOffset,
    });

    papers = pubmedResult.data;
    papersError = pubmedResult.error?.message;

    // Build papersMeta whenever ANY pagination field is present.
    // When the NCBI ceiling shortcut fires (actualLimit=0), totalCount is undefined
    // but hasMore and hitUpstreamLimit ARE set — we still need to surface them to the UI.
    if (
      pubmedResult.hasMore !== undefined ||
      pubmedResult.hitUpstreamLimit !== undefined ||
      pubmedResult.totalCount !== undefined
    ) {
      papersMeta = {
        totalCount: pubmedResult.totalCount ?? 0,
        pageSize: pubmedResult.pageSize ?? limit,
        offset: pubmedResult.offset ?? papersOffset,
        hasMore: pubmedResult.hasMore ?? false,
        nextOffset: pubmedResult.nextOffset ?? null,
        currentPage: pubmedResult.currentPage ?? 1,
        totalPages: pubmedResult.totalPages ?? 0,
        hitUpstreamLimit: pubmedResult.hitUpstreamLimit ?? false,
      };
    }
  }

  // ── Run GEO ────────────────────────────────────────────────────────────────
  if (!onlyPapers && runGeo) {
    const geoResult = await searchGeoDatasets(effectiveQuery, {
      limit,
      offset: datasetsOffset,
    });

    datasets = geoResult.data;
    datasetsError = geoResult.error?.message;

    if (
      geoResult.hasMore !== undefined ||
      geoResult.hitUpstreamLimit !== undefined ||
      geoResult.totalCount !== undefined
    ) {
      datasetsMeta = {
        totalCount: geoResult.totalCount ?? 0,
        pageSize: geoResult.pageSize ?? limit,
        offset: geoResult.offset ?? datasetsOffset,
        hasMore: geoResult.hasMore ?? false,
        nextOffset: geoResult.nextOffset ?? null,
        currentPage: geoResult.currentPage ?? 1,
        totalPages: geoResult.totalPages ?? 0,
        hitUpstreamLimit: geoResult.hitUpstreamLimit ?? false,
      };
    }
  }

  // ── Run Sequence Foundation (initial load only) ───────────────────────────
  // The sequence module does not support pagination — it runs once on the initial
  // load and is not triggered on Load More requests (Phase 5.1 design).
  // It runs sequentially after PubMed + GEO to share the NCBI rate-limit budget.
  // The module is self-rate-limited (350 ms delays between NCBI calls).
  let sequences: SequenceResource[] = [];
  let sequencesError: string | undefined;

  if (isInitialLoad) {
    const seqResult = await searchSequenceResources(effectiveQuery);
    sequences = seqResult.data;
    sequencesError = seqResult.error?.message;
  }

  // ── Run Gene Explorer (initial load + gene pagination) ────────────────────
  // Gene Explorer runs on the initial load and on gene-specific Load More requests
  // (genesOffset > 0). It is skipped on PubMed-only or GEO-only pagination.
  //
  // The gene module is self-rate-limited (350 ms delays between NCBI calls).
  // It runs sequentially after Sequence Foundation to share the NCBI rate-limit budget.
  //
  // Gating: the gene module gates itself when the resolver identifies a non-gene
  // entity type at HIGH confidence (Organism, Disease, Accession, etc.).
  // The resolver result (resolution) is passed so the gene module can make that call.
  let genes: GeneRecord[] = [];
  let genesMeta: PaginationMeta | null = null;
  let genesError: string | undefined;

  if (runGenes) {
    const geneResult = await searchGeneExplorer(effectiveQuery, {
      limit,
      offset: genesOffset,
      resolution: geneAdapterResolution,
    });

    genes = geneResult.data;
    genesError = geneResult.error?.message;

    if (
      geneResult.hasMore !== undefined ||
      geneResult.hitUpstreamLimit !== undefined ||
      geneResult.totalCount !== undefined
    ) {
      genesMeta = {
        totalCount: geneResult.totalCount ?? 0,
        pageSize: geneResult.pageSize ?? limit,
        offset: geneResult.offset ?? genesOffset,
        hasMore: geneResult.hasMore ?? false,
        nextOffset: geneResult.nextOffset ?? null,
        currentPage: geneResult.currentPage ?? 1,
        totalPages: geneResult.totalPages ?? 0,
        hitUpstreamLimit: geneResult.hitUpstreamLimit ?? false,
      };
    }

    // ── Run Transcript Explorer (Phase 5.3A) for the primary resolved gene ────
    // Only the first (primary) gene gets full TranscriptRecord[] — matches the
    // "resolved gene" semantics used elsewhere in this route. Non-gene queries
    // never reach this branch (runGenes is false, genes stays empty).
    if (genes.length > 0) {
      const primary = genes[0];
      await sleep(GENE_RATE_DELAY_MS);
      const transcriptResult = await searchTranscripts(
        primary.geneId,
        primary.officialSymbol,
        primary.organism,
        primary.taxonomyId
      );

      const isHumanGene = primary.taxonomyId === "9606";
      const fetchFailed = transcriptResult.status === "error";

      genes[0] = {
        ...primary,
        transcripts: {
          available: transcriptResult.data.length > 0,
          count: fetchFailed ? null : transcriptResult.data.length,
          records: fetchFailed ? null : transcriptResult.data,
          maneSelectPresent: fetchFailed
            ? null
            : isHumanGene
            ? transcriptResult.data.some((t) => t.isCanonical === true)
            : null,
        },
      };
    }
  }

  // Mock data — will be replaced by OpenAI reasoning over papers + datasets.
  // Only included in the initial response (both offsets = 0) for efficiency.
  // On pagination requests, these are empty arrays — the frontend ignores them.
  const landscape = isInitialLoad
    ? ["Transcriptomics", "Biomarker Discovery", "Machine Learning"]
    : [];
  const emergingAreas = isInitialLoad
    ? ["Multi-omics integration", "AI-assisted biomarker prediction", "Single-cell transcriptomics"]
    : [];
  const researchGaps = isInitialLoad
    ? ["Limited South Asian cohorts", "Lack of longitudinal validation studies", "Insufficient multi-omics datasets"]
    : [];
  const projects = isInitialLoad
    ? ["RNA-seq meta-analysis", "Machine learning classification system", "Multi-omics biomarker prediction"]
    : [];

  const result: AnalyzeResponse = {
    landscape,
    emergingAreas,
    researchGaps,
    projects,
    papers,
    papersMeta,
    datasets,
    datasetsMeta,
    sequences,
    genes,
    genesMeta,
    resolution,
    effectiveQuery,
    ...(papersError && { papersError }),
    ...(datasetsError && { datasetsError }),
    ...(sequencesError && { sequencesError }),
    ...(genesError && { genesError }),
  };

  return NextResponse.json(result, { status: 200 });
}
