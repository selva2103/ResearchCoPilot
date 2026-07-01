import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import { searchGeoDatasets } from "@/lib/geo";
import { searchSequenceResources } from "@/lib/genbank";
import { resolveQuery } from "@/lib/resolver";
import type { Paper } from "@/types/paper";
import type { Dataset } from "@/types/dataset";
import type { SequenceResource } from "@/types/sequence-resource";
import type { QueryResolution } from "@/types/query-resolution";

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
   * Structured result of the Biological Query Resolution Layer (Phase 5.1.5).
   * Populated on the initial load only — null on Load More requests.
   *
   * Confidence-tier gating (Step 5):
   *   HIGH   (≥ 0.90) — effectiveQuery was auto-set to normalizedQuery; downstream
   *                      modules received the normalized query on this request.
   *   MEDIUM (0.60–0.89) — suggestion shown to user; originalQuery was used for modules.
   *   LOW    (< 0.60)    — Unknown; originalQuery was used unchanged.
   */
  resolution: QueryResolution | null;

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

  // ── Smart module selection ────────────────────────────────────────────────
  // On the initial load (both offsets = 0) we run both modules sequentially to respect
  // the shared 3 req/s NCBI rate limit (concurrent: 5 calls at once → HTTP 429).
  //
  // On pagination:
  //   Load More Papers (papersOffset > 0, datasetsOffset = 0) → run only PubMed
  //   Load More Datasets (datasetsOffset > 0, papersOffset = 0) → run only GEO
  //   Both > 0 (not yet used by frontend, but supported) → run both sequentially
  //
  // This saves NCBI API calls and keeps us within rate limits on every pagination click.
  //
  // PubMed costs 3 upstream calls per page (ESearch, ESummary, EFetch).
  // GEO costs 2 upstream calls per page (ESearch, ESummary).
  // Never run both modules concurrently — sequential execution is intentional.

  const runPubMed = papersOffset > 0 || datasetsOffset === 0;
  const runGeo = datasetsOffset > 0 || papersOffset === 0;

  // Both offsets 0 → run both (initial load). papersOffset > 0 only → PubMed only.
  // datasetsOffset > 0 only → GEO only. Both > 0 → both.
  const onlyPapers = papersOffset > 0 && datasetsOffset === 0;
  const onlyDatasets = datasetsOffset > 0 && papersOffset === 0;
  const isInitialLoad = papersOffset === 0 && datasetsOffset === 0;

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
  let resolution: QueryResolution | null = null;
  let effectiveQuery: string;

  if (isInitialLoad) {
    resolution = await resolveQuery(query);
    if (
      resolution.confidenceTier === "high" &&
      resolution.normalizedQuery !== resolution.originalQuery
    ) {
      // HIGH tier: auto-apply the normalized query to all downstream modules
      effectiveQuery = resolution.normalizedQuery;
    } else {
      // MEDIUM or LOW: use the original query unchanged
      effectiveQuery = query;
    }
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
    resolution,
    effectiveQuery,
    ...(papersError && { papersError }),
    ...(datasetsError && { datasetsError }),
    ...(sequencesError && { sequencesError }),
  };

  return NextResponse.json(result, { status: 200 });
}
