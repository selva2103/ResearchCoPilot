import { NextRequest, NextResponse } from "next/server";
import { searchPubMed } from "@/lib/pubmed";
import { searchGeoDatasets } from "@/lib/geo";
import type { Paper } from "@/types/paper";
import type { Dataset } from "@/types/dataset";

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

  let papers: Paper[] = [];
  let papersMeta: PaginationMeta | null = null;
  let papersError: string | undefined;

  let datasets: Dataset[] = [];
  let datasetsMeta: PaginationMeta | null = null;
  let datasetsError: string | undefined;

  // ── Run PubMed ─────────────────────────────────────────────────────────────
  if (!onlyDatasets && runPubMed) {
    const pubmedResult = await searchPubMed(query, {
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
    const geoResult = await searchGeoDatasets(query, {
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

  // Mock data — will be replaced by OpenAI reasoning over papers + datasets.
  // Only included in the initial response (both offsets = 0) for efficiency.
  // On pagination requests, these are empty arrays — the frontend ignores them.
  const isInitialLoad = papersOffset === 0 && datasetsOffset === 0;
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
    ...(papersError && { papersError }),
    ...(datasetsError && { datasetsError }),
  };

  return NextResponse.json(result, { status: 200 });
}
