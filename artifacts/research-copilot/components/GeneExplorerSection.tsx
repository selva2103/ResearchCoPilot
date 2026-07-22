"use client";

/**
 * GeneExplorerSection.tsx — Gene Explorer UI card (Phase 5.2)
 *
 * Renders the Gene Explorer results card within the results page grid.
 * Follows the same card pattern as DatasetsSection and SequenceSection —
 * reuses the existing card shape, does NOT redesign the application.
 *
 * Accent colour: emerald (green) — differentiated from existing teal (Sequence),
 * violet (GEO), and indigo/blue (PubMed) cards.
 *
 * Error state hierarchy (Step 8):
 *   - Full failure:             ModuleResult status "error" → show error card
 *   - Partial enrichment fail:  status "partial" → show core data + enrichment note
 *   - No gene found:            status "empty" → show empty state
 *   - Rate limited:             code "RATE_LIMITED" → show specific message
 *   - Non-gene query routed:    genes === [] AND no error → render nothing (hidden)
 *
 * Summary section rule (Step 7):
 *   The card MUST remain fully visible regardless of whether a summary exists.
 *   When summary is null: render "No curated summary available for this gene."
 *   (The section is never collapsed or omitted on null.)
 *
 * Null field display rule (Step 8):
 *   All null cross-database fields must render as "Not available" — never empty/broken.
 *
 * Lazy vs eager ELink:
 *   Primary gene record (index 0): received full ELink data from Path B.
 *   Additional records (index 1+): linkEnrichment = "none" — ELink data deferred.
 *   The UI notes this in the expandable resources footer of non-primary cards.
 */

import { useState, useEffect, useRef } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { TranscriptRecord } from "@/types/transcript-record";
import type { ProteinRecord } from "@/types/protein-record";
import type { NormalizedQuery } from "@/types/normalized-query";
import type { ProteinResearchContext } from "@/types/research-context";
import type { ModuleResult } from "@/types/module-result";
import VariantExplorerSection from "@/components/VariantExplorerSection";

// ─── PaginationMeta shape (mirrors API contract) ───────────────────────────────
interface PaginationMeta {
  totalCount: number;
  pageSize: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  currentPage: number;
  totalPages: number;
  hitUpstreamLimit: boolean;
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface GeneExplorerSectionProps {
  genes: GeneRecord[];
  meta: PaginationMeta | null;
  isLoading: boolean;
  pageError: string | null;
  retryOffset: number | null;
  genesError?: string;
  onLoadMore: () => void;
  onRetry: (offset: number) => void;
  /** Phase R resolver output — passed to ProteinPanel for Research Context derivation. */
  normalizedQuery?: NormalizedQuery | null;
}

// ─── Section root ──────────────────────────────────────────────────────────────

export default function GeneExplorerSection({
  genes,
  meta,
  isLoading,
  pageError,
  retryOffset,
  genesError,
  onLoadMore,
  onRetry,
  normalizedQuery = null,
}: GeneExplorerSectionProps) {
  // Hide section entirely when: no genes, no error, and no Loading state
  // (non-gene queries — organism/disease/accession — produce empty results legitimately)
  if (genes.length === 0 && !genesError && !isLoading) return null;

  const isRateLimit = genesError?.includes("429") || genesError?.includes("rate");

  return (
    <div className="col-span-1 sm:col-span-2 xl:col-span-3">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/60 overflow-hidden shadow-sm backdrop-blur-sm">
        {/* Header */}
        <div className="bg-emerald-600 px-5 py-4 flex items-center gap-2">
          <span className="text-xl">🧫</span>
          <h3 className="font-semibold text-white text-base">Gene Explorer</h3>
          {isLoading && (
            <span className="ml-1 text-emerald-200">
              <LoadingSpinner />
            </span>
          )}
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {genes.length > 0
              ? `${genes.length} gene${genes.length !== 1 ? "s" : ""}`
              : "—"}
          </span>
        </div>

        {/* Error state */}
        {genesError && genes.length === 0 && (
          <div className="px-5 py-6">
            {isRateLimit ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠️ NCBI rate limit hit — gene data temporarily unavailable. Try again in a few seconds.
              </p>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                ⚠️ {genesError}
              </p>
            )}
          </div>
        )}

        {/* Empty state */}
        {!genesError && genes.length === 0 && isLoading && (
          <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
            Loading gene data…
          </div>
        )}

        {/* Gene records */}
        {genes.length > 0 && (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {genes.map((gene, idx) => (
              <GeneCard
                key={gene.geneId}
                gene={gene}
                isPrimary={idx === 0}
                normalizedQuery={normalizedQuery}
              />
            ))}
          </div>
        )}

        {/* Pagination / Load More / Exhausted footer */}
        <GeneExplorationFooter
          meta={meta}
          isLoading={isLoading}
          pageError={pageError}
          retryOffset={retryOffset}
          onLoadMore={onLoadMore}
          onRetry={onRetry}
        />

        {/* Data attribution */}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50">
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            Live data — NCBI Gene ESummary (Path A) · ELink llinks Ensembl (Path B)
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Individual gene card ──────────────────────────────────────────────────────

function GeneCard({
  gene,
  isPrimary,
  normalizedQuery,
}: {
  gene: GeneRecord;
  isPrimary: boolean;
  normalizedQuery: NormalizedQuery | null;
}) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const SUMMARY_TRUNCATE = 280;

  // ── Gene FASTA download state ───────────────────────────────────────────────
  const [geneFastaState, setGeneFastaState] = useState<DownloadState>({ status: "idle" });

  const runGeneFastaDownload = () => {
    if (!gene.genomicAccession || gene.genomicStart === null || gene.genomicEnd === null || !gene.strand) return;
    setGeneFastaState({ status: "loading" });
    const strandNum = gene.strand === "-" ? 2 : 1;
    enqueueDownload(async () => {
      try {
        const url =
          `/api/gene/fasta?accession=${encodeURIComponent(gene.genomicAccession!)}` +
          `&start=${gene.genomicStart}&stop=${gene.genomicEnd}` +
          `&strand=${strandNum}&symbol=${encodeURIComponent(gene.officialSymbol)}`;
        const res = await fetch(url);
        if (!res.ok) {
          let message = `Download failed (HTTP ${res.status}).`;
          const isRateLimited = res.status === 429;
          try {
            const body = await res.json() as { error?: string };
            if (body.error) message = body.error;
          } catch { /* ignore */ }
          setGeneFastaState({ status: "error", message, rateLimited: isRateLimited });
          return;
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `${gene.officialSymbol}_${gene.genomicAccession}.fasta`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
        setGeneFastaState({ status: "idle" });
      } catch (err) {
        setGeneFastaState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error — could not reach the download service.",
        });
      }
    }).catch(() => {
      setGeneFastaState({ status: "error", message: "Download failed unexpectedly. Please try again." });
    });
  };

  const summaryText = gene.summary;
  const summaryLong = summaryText && summaryText.length > SUMMARY_TRUNCATE;
  const summaryDisplay = summaryLong && !summaryExpanded
    ? summaryText!.slice(0, SUMMARY_TRUNCATE) + "…"
    : summaryText;

  return (
    <div className="px-5 py-4 space-y-4">
      {/* ── Gene header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">
              {gene.officialSymbol}
            </span>
            {!isPrimary && (
              <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                additional result
              </span>
            )}
            {gene.linkEnrichment === "partial" && (
              <span className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">
                partial data
              </span>
            )}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-200 mt-0.5 leading-snug">
            {gene.fullName}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 italic">
            {gene.organism}
          </p>
        </div>

        <a
          href={gene.ncbiGeneUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-full hover:underline font-medium"
        >
          Gene ID: {gene.geneId} ↗
        </a>
      </div>

      {/* ── Core metadata chips ──────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {gene.chromosome && (
          <Chip label={`Chr ${gene.chromosome}`} color="emerald" />
        )}
        {gene.cytogeneticLocation && (
          <Chip label={gene.cytogeneticLocation} color="slate" />
        )}
        {gene.strand && gene.genomicStart !== null && gene.genomicEnd !== null && (
          <Chip
            label={`${gene.genomicStart.toLocaleString()}–${gene.genomicEnd.toLocaleString()} (${gene.strand})`}
            color="slate"
            mono
          />
        )}
        {gene.genomicAccession && gene.genomicStart !== null && gene.genomicEnd !== null && gene.strand && (
          <DownloadButton
            label="Download Gene FASTA"
            state={geneFastaState}
            onClick={runGeneFastaDownload}
          />
        )}
        {gene.geneType ? (
          <Chip label={gene.geneType} color="indigo" />
        ) : null}
      </div>

      {/* ── Cross-database IDs ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        <CrossDbField
          label="HGNC"
          value={gene.hgncId}
          href={gene.hgncId ? `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${gene.hgncId}` : null}
        />
        <CrossDbField
          label="Ensembl"
          value={gene.ensemblId}
          href={gene.ensemblUrl}
        />
        <CrossDbField
          label="OMIM"
          value={gene.omimId ? `MIM:${gene.omimId}` : null}
          href={gene.omimUrl}
        />
      </div>

      {/* Enrichment failure note */}
      {gene.enrichmentNote && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠️ {gene.enrichmentNote}
        </p>
      )}

      {/* ELink not fetched note (non-primary / lazy) */}
      {gene.linkEnrichment === "none" && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          Cross-database IDs (Ensembl, HGNC, OMIM) are loaded for the primary result only.
        </p>
      )}

      {/* ── Gene Summary ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">
          Gene Summary
        </p>
        {summaryText ? (
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {summaryDisplay}
            </p>
            {summaryLong && (
              <button
                onClick={() => setSummaryExpanded((v) => !v)}
                className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline mt-1"
              >
                {summaryExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">
            No curated summary available for this gene.
          </p>
        )}
      </div>

      {/* ── Aliases ──────────────────────────────────────────────────────── */}
      {gene.aliases.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">
            Aliases
          </p>
          <div className="flex flex-wrap gap-1.5">
            {gene.aliases.map((alias) => (
              <span
                key={alias}
                className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full font-mono"
              >
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Expandable Resources ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">
          Resources
        </p>
        <div className="flex flex-wrap gap-2">
          <ResourceBadge
            label="Transcripts"
            count={gene.transcripts.count}
            available={gene.transcripts.available}
            future={false}
            title="Transcript Explorer — see below"
          />
          <ResourceBadge
            label="Proteins"
            count={gene.proteins.estimatedCount}
            available={gene.proteins.available}
            future={false}
            title="Phase 5.4 — Protein Explorer"
          />
          <ResourceBadge
            label="Variants"
            available={gene.variants.available}
            count={gene.variants.count}
            future={false}
            title="Variant Explorer — see below"
          />
          <ResourceBadge
            label="Expression"
            available={gene.expression.available}
            count={null}
            future
            title="Phase 5.6 — Expression Data"
          />
          <ResourceBadge
            label="Pathways"
            available={gene.pathways.available}
            count={null}
            future
            title="Phase 5.7 — Pathway Analysis"
          />
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          Protein counts are lower-bound estimates from exon data. Transcript counts
          below are exact once loaded.
        </p>
      </div>

      {/* ── Transcript Explorer (Phase 5.3A) ─────────────────────────────── */}
      {isPrimary && <TranscriptExplorer gene={gene} normalizedQuery={normalizedQuery} />}
      {isPrimary && gene.variants.available && (
        <VariantExplorerSection gene={gene} />
      )}
    </div>
  );
}

// ─── Transcript Explorer sub-section ───────────────────────────────────────────

const TRANSCRIPT_PAGE_SIZE = 10;

function TranscriptExplorer({
  gene,
  normalizedQuery,
}: {
  gene: GeneRecord;
  normalizedQuery: NormalizedQuery | null;
}) {
  const { available, count, records, maneSelectPresent } = gene.transcripts;
  const isHumanGene = gene.taxonomyId === "9606";

  // Accordion state — at most one transcript row expanded at a time.
  const [expandedAccession, setExpandedAccession] = useState<string | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);

  // Pagination state — client-side slice of the already-fetched records[].
  // All records are in memory; no extra Entrez calls are made for Load More.
  const [visibleCount, setVisibleCount] = useState(TRANSCRIPT_PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ── Protein summaries — fetched once per gene on first transcript expand ──
  // keyed by proteinAccessionVersion → ProteinRecord
  const [proteinSummaries, setProteinSummaries] = useState<Map<string, ProteinRecord> | null>(null);
  const [proteinSummaryLoading, setProteinSummaryLoading] = useState(false);
  const [proteinSummaryError, setProteinSummaryError] = useState<string | null>(null);
  // Guard against duplicate in-flight requests.
  const proteinFetchedRef = useRef(false);

  const fetchProteinSummaries = async () => {
    if (proteinFetchedRef.current || proteinSummaryLoading) return;
    const allRecords = records ?? [];
    const codingTranscripts = allRecords.filter((t) => t.proteinAccessionVersion !== null);
    if (codingTranscripts.length === 0) {
      // No coding transcripts — mark as fetched with empty map.
      proteinFetchedRef.current = true;
      setProteinSummaries(new Map());
      return;
    }
    proteinFetchedRef.current = true;
    setProteinSummaryLoading(true);
    try {
      const res = await fetch("/api/protein/summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcripts: allRecords }),
      });
      const result: ModuleResult<ProteinRecord> = await res.json();
      if (result.status === "error") {
        setProteinSummaryError(result.error?.message ?? "Protein data temporarily unavailable.");
      } else {
        const map = new Map<string, ProteinRecord>();
        for (const pr of result.data) {
          map.set(pr.proteinAccessionVersion, pr);
        }
        setProteinSummaries(map);
        if (result.status === "partial" && result.error) {
          setProteinSummaryError(result.error.message);
        }
      }
    } catch {
      setProteinSummaryError("Protein data temporarily unavailable.");
    } finally {
      setProteinSummaryLoading(false);
    }
  };

  const handleToggle = (accessionVersion: string, hasCodingProtein: boolean) => {
    try {
      setExpandError(null);
      const isOpening = expandedAccession !== accessionVersion;
      setExpandedAccession((prev) => (prev === accessionVersion ? null : accessionVersion));
      // Trigger batched protein summary fetch only when expanding a coding transcript
      // (one with a proteinAccessionVersion). Non-coding transcripts never trigger
      // a protein NCBI call — there is no protein to fetch for them.
      if (isOpening && hasCodingProtein && !proteinFetchedRef.current) {
        fetchProteinSummaries();
      }
    } catch {
      // Defensive — expand/collapse is pure client state and should never throw,
      // but per spec the gene card must never crash on an expand failure.
      setExpandError("Unable to expand this transcript row. Please try again.");
    }
  };

  const handleLoadMore = () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    // Use requestAnimationFrame so the disabled state renders before the count
    // updates — this prevents a rapid double-click from processing twice before
    // React batches the state change.
    requestAnimationFrame(() => {
      setVisibleCount((v) => v + TRANSCRIPT_PAGE_SIZE);
      setIsLoadingMore(false);
    });
  };

  const allRecords = records ?? [];
  const visibleRecords = allRecords.slice(0, visibleCount);
  const hasMoreTranscripts = allRecords.length > visibleCount;
  // "All transcripts loaded" is shown only when pagination was actually used
  // (i.e. there were more than one page worth of results).
  const showAllLoaded =
    allRecords.length > TRANSCRIPT_PAGE_SIZE && !hasMoreTranscripts;

  return (
    <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm">🧬</span>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide">
          Transcript Explorer
        </p>
        {allRecords.length > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
            {count} transcript{count !== 1 ? "s" : ""}
          </span>
        )}
        {isHumanGene && maneSelectPresent === true && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
            MANE Select present
          </span>
        )}
      </div>

      {/* Error state — transcript fetch failed outright */}
      {records === null && !available && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Transcript data temporarily unavailable.
        </p>
      )}

      {/* Empty state — fetch succeeded but zero transcripts */}
      {records !== null && records.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No RefSeq transcripts found for this gene.
        </p>
      )}

      {expandError && (
        <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ {expandError}</p>
      )}

      {/* Paginated list — only visibleCount rows rendered at a time */}
      {allRecords.length > 0 && (
        <div className="space-y-2">
          {visibleRecords.map((t) => (
            <TranscriptRow
              key={t.accessionVersion}
              transcript={t}
              isExpanded={expandedAccession === t.accessionVersion}
              onToggleExpand={() => handleToggle(t.accessionVersion, t.proteinAccessionVersion !== null)}
              proteinRecord={
                t.proteinAccessionVersion
                  ? (proteinSummaries?.get(t.proteinAccessionVersion) ?? undefined)
                  : null
              }
              proteinSummaryLoading={proteinSummaryLoading}
              proteinSummaryError={proteinSummaryError}
              geneRecord={gene}
              normalizedQuery={normalizedQuery}
            />
          ))}
        </div>
      )}

      {/* Load More button — shown while there are hidden transcripts */}
      {hasMoreTranscripts && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="text-xs font-semibold px-4 py-2 rounded-full transition-all disabled:opacity-50 disabled:cursor-wait bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
          >
            {isLoadingMore ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner />
                Loading…
              </span>
            ) : (
              "Load More Transcripts"
            )}
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {visibleCount} of {allRecords.length}
          </p>
        </div>
      )}

      {/* Exhausted state — only after pagination was used */}
      {showAllLoaded && (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-1">
          All transcripts loaded
        </p>
      )}
    </div>
  );
}

// ─── Client-side sequential download queue ─────────────────────────────────────
// All FASTA/CDS downloads (across every transcript row on the page) are funneled
// through this single module-level promise chain so that rapid clicks never fire
// concurrent requests to the download API — matching the "sequential, not
// concurrent" NCBI rate-limit requirement. The API route itself also serializes
// via GENE_RATE_DELAY_MS/sleep server-side; this queue keeps the client UX
// (loading states) honestly sequential too.
let clientDownloadChain: Promise<void> = Promise.resolve();

function enqueueDownload<T>(task: () => Promise<T>): Promise<T> {
  const result = clientDownloadChain.then(task, task);
  clientDownloadChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

type DownloadStatus = "idle" | "loading" | "error";
interface DownloadState {
  status: DownloadStatus;
  message?: string;
  rateLimited?: boolean;
}

function TranscriptRow({
  transcript,
  isExpanded,
  onToggleExpand,
  proteinRecord,
  proteinSummaryLoading,
  proteinSummaryError,
  geneRecord,
  normalizedQuery,
}: {
  transcript: TranscriptRecord;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** undefined = summaries not yet fetched; null = non-coding transcript (no protein) */
  proteinRecord: ProteinRecord | null | undefined;
  proteinSummaryLoading: boolean;
  proteinSummaryError: string | null;
  geneRecord: GeneRecord;
  normalizedQuery: NormalizedQuery | null;
}) {
  const prefixColor: Record<TranscriptRecord["accessionPrefix"], string> = {
    NM_: "bg-emerald-600 text-white",
    NR_: "bg-teal-600 text-white",
    XM_: "bg-slate-400 text-white",
    XR_: "bg-slate-400 text-white",
    other: "bg-slate-400 text-white",
  };

  const typeLabel: Record<TranscriptRecord["transcriptType"], string> = {
    mRNA: "mRNA",
    ncRNA: "ncRNA",
    predicted_mRNA: "Predicted mRNA",
    predicted_ncRNA: "Predicted ncRNA",
    other: "Other",
  };

  const isCoding =
    transcript.accessionPrefix === "NM_" || transcript.accessionPrefix === "XM_";

  const [fastaState, setFastaState] = useState<DownloadState>({ status: "idle" });
  const [cdsState, setCdsState] = useState<DownloadState>({ status: "idle" });

  // Lazy transcript summary — fetched once on first expand, never on page load.
  // undefined = not yet fetched; null = fetched but no summary available; string = summary text.
  const [summary, setSummary] = useState<string | null | undefined>(undefined);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    // Only fetch when expanded for the first time (summary === undefined).
    if (!isExpanded || summary !== undefined) return;
    let cancelled = false;
    setSummaryLoading(true);
    fetch(
      `/api/transcript/summary?accession=${encodeURIComponent(transcript.accessionVersion)}`
    )
      .then((r) => r.json())
      .then((data: { summary?: string | null; error?: string }) => {
        if (!cancelled) setSummary(data.summary ?? null);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, summary, transcript.accessionVersion]);

  const runDownload = (kind: "fasta" | "cds") => {
    const setState = kind === "fasta" ? setFastaState : setCdsState;
    setState({ status: "loading" });

    enqueueDownload(async () => {
      try {
        const res = await fetch(
          `/api/transcript/download?accession=${encodeURIComponent(
            transcript.accessionVersion
          )}&type=${kind}`
        );

        if (!res.ok) {
          let message = `Download failed (HTTP ${res.status}).`;
          let rateLimited = res.status === 429;
          try {
            const body = (await res.json()) as { error?: string; rateLimited?: boolean };
            if (body.error) message = body.error;
            if (body.rateLimited) rateLimited = true;
          } catch {
            // Response wasn't JSON — keep the generic message above.
          }
          setState({ status: "error", message, rateLimited });
          return;
        }

        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const filenameMatch = disposition.match(/filename="([^"]+)"/);
        const filename =
          filenameMatch?.[1] ??
          `${transcript.accessionVersion}${kind === "cds" ? "_cds" : ""}.fasta`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        setState({ status: "idle" });
      } catch (err) {
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Network error — could not reach the download service.",
        });
      }
    }).catch(() => {
      // enqueueDownload itself never rejects (errors are caught above), but
      // guard defensively so a queue failure can never crash the gene card.
      setState({
        status: "error",
        message: "Download failed unexpectedly. Please try again.",
      });
    });
  };

  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
      >
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${prefixColor[transcript.accessionPrefix]}`}
          title="Curated (NM_/NR_) vs computationally predicted (XM_/XR_)"
        >
          {transcript.accessionPrefix === "other" ? "OTHER" : transcript.accessionPrefix.slice(0, -1)}
        </span>

        <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-medium">
          {transcript.accessionVersion}
        </span>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          {typeLabel[transcript.transcriptType]}
        </span>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          {transcript.transcriptLength !== null
            ? `${transcript.transcriptLength.toLocaleString()} nt`
            : "length not available"}
        </span>

        <span className="text-xs text-slate-500 dark:text-slate-400">
          {transcript.exonCount !== null ? `${transcript.exonCount} exons` : "exon count not available"}
        </span>

        {transcript.status && (
          <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
            {transcript.status}
          </span>
        )}

        {transcript.isCanonical === true && (
          <span className="text-xs font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 px-2 py-0.5 rounded-full">
            MANE Select
          </span>
        )}

        {transcript.manePlusClinical && (
          <span className="text-xs font-semibold bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-800 dark:text-fuchsia-200 px-2 py-0.5 rounded-full">
            MANE Plus Clinical
          </span>
        )}

        <span className="ml-auto text-slate-400 dark:text-slate-500 text-xs">
          {isExpanded ? "▲ Hide details" : "▼ Show details"}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/60 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 pt-2">
            <DetailField label="Transcript ID" value={transcript.transcriptId} />
            <DetailField
              label="Protein"
              value={transcript.proteinAccessionVersion}
              href={
                transcript.proteinAccessionVersion
                  ? `https://www.ncbi.nlm.nih.gov/protein/${transcript.proteinAccessionVersion}`
                  : null
              }
              fallback={isCoding ? "Not available" : "N/A — non-coding"}
            />
            <DetailField label="Source" value="NCBI RefSeq" />
          </div>

          {/* Transcript-level RefSeq summary — lazy-loaded on first expand.
              Omitted entirely when no summary is available (no empty card/placeholder). */}
          {summaryLoading && (
            <div className="flex items-center gap-1.5">
              <LoadingSpinner />
              <span className="text-xs text-slate-400 dark:text-slate-500">
                Loading summary…
              </span>
            </div>
          )}
          {!summaryLoading && summary && (
            <div className="space-y-1">
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">
                RefSeq Summary
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {summary}
              </p>
            </div>
          )}
          {/* summary === null → no section rendered (intentional per spec) */}

          <a
            href={transcript.ncbiTranscriptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            View on NCBI Nucleotide ↗
          </a>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <DownloadButton
              label="Download FASTA"
              state={fastaState}
              onClick={() => runDownload("fasta")}
            />

            {isCoding ? (
              <DownloadButton
                label="Download CDS"
                state={cdsState}
                onClick={() => runDownload("cds")}
              />
            ) : (
              <span
                className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-1"
                title="Non-coding RNA transcripts have no coding sequence"
              >
                Non-coding transcript
              </span>
            )}
          </div>

          {/* ── Protein sub-panel ─────────────────────────────────────── */}
          <ProteinPanel
            transcript={transcript}
            isCoding={isCoding}
            proteinRecord={proteinRecord}
            proteinSummaryLoading={proteinSummaryLoading}
            proteinSummaryError={proteinSummaryError}
            geneRecord={geneRecord}
            normalizedQuery={normalizedQuery}
          />
        </div>
      )}
    </div>
  );
}

// ─── Protein sub-panel ────────────────────────────────────────────────────────

/**
 * Renders the Protein sub-section nested inside an expanded TranscriptRow.
 *
 * Behaviour:
 *   - Non-coding transcript (isCoding=false OR proteinRecord=null):
 *       → "Non-coding transcript — no protein"
 *   - Protein summaries still loading:
 *       → loading spinner
 *   - Protein summaries failed:
 *       → "Protein data temporarily unavailable."
 *   - Protein summary available (proteinRecord present):
 *       → collapsed sub-accordion showing accession, status, length, canonical badge
 *       → on expand: fetch detail (proteinName, molecularWeight) + Download FASTA button
 */
function ProteinPanel({
  transcript,
  isCoding,
  proteinRecord,
  proteinSummaryLoading,
  proteinSummaryError,
  geneRecord,
  normalizedQuery,
}: {
  transcript: TranscriptRecord;
  isCoding: boolean;
  proteinRecord: ProteinRecord | null | undefined;
  proteinSummaryLoading: boolean;
  proteinSummaryError: string | null;
  geneRecord: GeneRecord;
  normalizedQuery: NormalizedQuery | null;
}) {
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ProteinRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [fastaState, setFastaState] = useState<DownloadState>({ status: "idle" });
  const detailFetchedRef = useRef(false);

  // ── Research Context (Phase 5.4B) — lazy, collapsed by default ─────────────
  // Derivation is computational (no direct network fetch on our side beyond
  // the one route call), but per spec it must still not run until the user
  // explicitly expands this subsection.
  const [rcExpanded, setRcExpanded] = useState(false);
  const [rcContext, setRcContext] = useState<ProteinResearchContext | null>(null);
  const [rcLoading, setRcLoading] = useState(false);
  const [rcError, setRcError] = useState<string | null>(null);
  const rcFetchedRef = useRef(false);
  // Guards against a stale response overwriting a newer one when the user
  // rapidly expands/collapses different transcripts' protein panels.
  const rcRequestAccessionRef = useRef<string | null>(null);

  const handleResearchContextToggle = async () => {
    const opening = !rcExpanded;
    setRcExpanded((v) => !v);
    if (opening && !rcFetchedRef.current && proteinRecord) {
      rcFetchedRef.current = true;
      const accession = proteinRecord.proteinAccessionVersion;
      rcRequestAccessionRef.current = accession;
      setRcLoading(true);
      setRcError(null);
      try {
        const res = await fetch("/api/protein/research-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accession,
            baseRecord: proteinRecord,
            transcriptRecord: transcript,
            geneRecord,
            normalizedQuery,
          }),
        });
        const result: ModuleResult<ProteinResearchContext> = await res.json();
        // Ignore a response that no longer matches the currently-relevant accession
        // (guards against stale data if the user expanded a different protein first).
        if (rcRequestAccessionRef.current !== accession) return;
        if (result.status === "error" || result.data.length === 0) {
          setRcError(result.error?.message ?? "Context unavailable.");
        } else {
          setRcContext(result.data[0]);
        }
      } catch {
        if (rcRequestAccessionRef.current === accession) {
          setRcError("Context unavailable.");
        }
      } finally {
        if (rcRequestAccessionRef.current === accession) {
          setRcLoading(false);
        }
      }
    }
  };

  const handleDetailToggle = async () => {
    const opening = !detailExpanded;
    setDetailExpanded((v) => !v);
    if (opening && !detailFetchedRef.current && proteinRecord) {
      detailFetchedRef.current = true;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch("/api/protein/detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accession: proteinRecord.proteinAccessionVersion, baseRecord: proteinRecord }),
        });
        const result: ModuleResult<ProteinRecord> = await res.json();
        if (result.status === "error" || result.data.length === 0) {
          setDetailError(result.error?.message ?? "Could not load protein detail.");
        } else {
          setDetailRecord(result.data[0]);
        }
      } catch {
        setDetailError("Network error — protein detail unavailable.");
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const runProteinFastaDownload = () => {
    if (!proteinRecord) return;
    setFastaState({ status: "loading" });
    enqueueDownload(async () => {
      try {
        const res = await fetch(
          `/api/protein/download?accession=${encodeURIComponent(proteinRecord.proteinAccessionVersion)}`
        );
        if (!res.ok) {
          let message = `Download failed (HTTP ${res.status}).`;
          let rateLimited = res.status === 429;
          try {
            const body = (await res.json()) as { error?: string; rateLimited?: boolean };
            if (body.error) message = body.error;
            if (body.rateLimited) rateLimited = true;
          } catch { /* ignore */ }
          setFastaState({ status: "error", message, rateLimited });
          return;
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const filenameMatch = disposition.match(/filename="([^"]+)"/);
        const filename = filenameMatch?.[1] ?? `${proteinRecord.proteinAccessionVersion}.fasta`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setFastaState({ status: "idle" });
      } catch (err) {
        setFastaState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error — could not reach the download service.",
        });
      }
    }).catch(() => {
      setFastaState({ status: "error", message: "Download failed unexpectedly. Please try again." });
    });
  };

  // The displayed record is the enriched detail if available, otherwise the summary.
  const displayRecord = detailRecord ?? proteinRecord;

  return (
    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/60">
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide mb-1.5">
        🧪 Protein
      </p>

      {/* Non-coding transcript — no protein fetch attempted */}
      {(!isCoding || proteinRecord === null) && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          Non-coding transcript — no protein
        </p>
      )}

      {/* Loading summaries */}
      {isCoding && proteinRecord === undefined && proteinSummaryLoading && (
        <div className="flex items-center gap-1.5">
          <LoadingSpinner />
          <span className="text-xs text-slate-400 dark:text-slate-500">Loading protein data…</span>
        </div>
      )}

      {/* Summary fetch error — transcript row and other sections unaffected */}
      {isCoding && proteinRecord === undefined && !proteinSummaryLoading && proteinSummaryError && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠️ Protein data temporarily unavailable.
        </p>
      )}

      {/* Protein summary available — show collapsed sub-accordion */}
      {isCoding && displayRecord && (
        <div className="rounded-md bg-slate-100 dark:bg-slate-800/60 overflow-hidden">
          {/* Sub-accordion header — summary metadata (always visible) */}
          <button
            type="button"
            onClick={handleDetailToggle}
            className="w-full flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
          >
            {/* Accession link */}
            <a
              href={displayRecord.ncbiProteinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              {displayRecord.proteinAccessionVersion} ↗
            </a>

            {/* Status badge */}
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                displayRecord.status === "Reviewed"
                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200"
                  : displayRecord.status === "Predicted"
                  ? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}
            >
              {displayRecord.status}
            </span>

            {/* Length */}
            {displayRecord.length !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {displayRecord.length.toLocaleString()} aa
              </span>
            )}

            {/* Canonical badge — only if isCanonical is explicitly true */}
            {displayRecord.isCanonical === true && (
              <span className="text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 px-1.5 py-0.5 rounded-full">
                Canonical
              </span>
            )}

            <span className="ml-auto text-slate-400 dark:text-slate-500 text-[11px]">
              {detailExpanded ? "▲" : "▼"}
            </span>
          </button>

          {/* Detail section — shown only when expanded */}
          {detailExpanded && (
            <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-200 dark:border-slate-700/60 space-y-2">
              {/* ── Research Context (Phase 5.4B) — expandable, above raw fields ── */}
              <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700/60 overflow-hidden">
                <button
                  type="button"
                  onClick={handleResearchContextToggle}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    🔬 Research Context
                  </span>
                  <span className="ml-auto text-slate-400 dark:text-slate-500 text-[11px]">
                    {rcExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {rcExpanded && (
                  <div className="px-2 pb-2 pt-0.5 border-t border-slate-200 dark:border-slate-700/60 space-y-2.5">
                    {rcLoading && (
                      <div className="flex items-center gap-1.5">
                        <LoadingSpinner />
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          Deriving research context…
                        </span>
                      </div>
                    )}

                    {/* Derivation failed — ProteinRecord/FASTA above is unaffected, quiet note only */}
                    {!rcLoading && rcError && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                        Context unavailable.
                      </p>
                    )}

                    {!rcLoading && !rcError && rcContext && (
                      <>
                        {/* Biological summary */}
                        {rcContext.summary && (
                          <div className="space-y-0.5">
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                              Summary
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug line-clamp-4 sm:line-clamp-none">
                              {rcContext.summary.text}
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                              Source: {rcContext.summary.source}
                            </p>
                          </div>
                        )}

                        {/* Biological role chips — each with its own evidence source */}
                        {rcContext.roleChips.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                              Biological Role
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {rcContext.roleChips.map((chip, i) => (
                                <span
                                  key={`${chip.label}-${i}`}
                                  title={`Source: ${chip.source}`}
                                  className="text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-1.5 py-0.5 rounded-full"
                                >
                                  {chip.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Canonical / isoform explanation */}
                        <div className="space-y-0.5">
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                            Canonical Status
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                            {rcContext.canonicalExplanation}
                          </p>
                        </div>

                        {/* Two distinct, visually-differentiated confidence indicators */}
                        <div className="flex flex-wrap gap-1.5">
                          <span
                            title="Resolution Confidence — how confidently the query resolved to this gene/organism (Phase R)"
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                              rcContext.resolutionConfidence === "high"
                                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
                                : rcContext.resolutionConfidence === "medium"
                                ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                                : rcContext.resolutionConfidence === "low"
                                ? "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600"
                            }`}
                          >
                            Resolution: {rcContext.resolutionConfidence}
                          </span>
                          <span
                            title="Annotation Confidence — how well-annotated the underlying GenPept record is"
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              rcContext.annotationConfidence === "well-annotated"
                                ? "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
                                : rcContext.annotationConfidence === "limited"
                                ? "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                            }`}
                          >
                            Annotation: {rcContext.annotationConfidence}
                          </span>
                        </div>

                        {/* Biological Importance — omitted cleanly when not grounded */}
                        {rcContext.biologicalImportance && (
                          <div className="space-y-0.5">
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                              Biological Importance
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                              {rcContext.biologicalImportance.text}
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                              Source: {rcContext.biologicalImportance.source}
                            </p>
                          </div>
                        )}

                        {/* Protein Relationships — compact Gene → Transcript → Protein → Species chain */}
                        <div className="space-y-0.5">
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                            Relationships
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 font-mono leading-snug break-words">
                            {rcContext.relationships.gene}
                            {" → "}
                            {rcContext.relationships.transcript}
                            {" → "}
                            {rcContext.relationships.protein}
                            {" → "}
                            {rcContext.relationships.species}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Loading detail */}
              {detailLoading && (
                <div className="flex items-center gap-1.5">
                  <LoadingSpinner />
                  <span className="text-xs text-slate-400 dark:text-slate-500">Loading protein detail…</span>
                </div>
              )}

              {/* Detail error */}
              {!detailLoading && detailError && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ {detailError}
                </p>
              )}

              {/* Detail fields */}
              {!detailLoading && !detailError && (
                <div className="space-y-1.5">
                  {displayRecord.proteinName && (
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Name</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                        {displayRecord.proteinName}
                      </p>
                    </div>
                  )}
                  {displayRecord.molecularWeight != null && (
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Molecular Weight</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                        {displayRecord.molecularWeight.toLocaleString()} Da
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* FASTA download — shown once detail loaded */}
              {!detailLoading && (
                <DownloadButton
                  label="Download FASTA"
                  state={fastaState}
                  onClick={runProteinFastaDownload}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailField({
  label,
  value,
  href,
  fallback = "Not available",
}: {
  label: string;
  value: string | null;
  href?: string | null;
  fallback?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">{label}</p>
      {value ? (
        href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-mono"
          >
            {value} ↗
          </a>
        ) : (
          <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">{value}</span>
        )
      ) : (
        <span className="text-xs text-slate-400 dark:text-slate-500 italic">{fallback}</span>
      )}
    </div>
  );
}

function DownloadButton({
  label,
  state,
  onClick,
}: {
  label: string;
  state: DownloadState;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state.status === "loading"}
        className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
          state.status === "error"
            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50"
            : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
        } disabled:opacity-60 disabled:cursor-wait`}
      >
        {state.status === "loading" ? (
          <span className="flex items-center gap-1.5">
            <LoadingSpinner />
            Preparing…
          </span>
        ) : state.status === "error" ? (
          `Retry ${label}`
        ) : (
          label
        )}
      </button>
      {state.status === "error" && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 max-w-[220px] leading-snug">
          {state.rateLimited
            ? "⚠️ NCBI rate limit hit — please wait a moment and try again."
            : `⚠️ ${state.message ?? "Download failed."}`}
        </p>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Chip({
  label,
  color,
  mono = false,
}: {
  label: string;
  color: "emerald" | "slate" | "indigo";
  mono?: boolean;
}) {
  const cls = {
    emerald:
      "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    slate:
      "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
    indigo:
      "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400",
  }[color];
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${cls} ${mono ? "font-mono" : ""}`}
    >
      {label}
    </span>
  );
}

function CrossDbField({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{label}</p>
      {value && href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-mono"
        >
          {value} ↗
        </a>
      ) : value ? (
        <span className="text-xs text-slate-600 dark:text-slate-300 font-mono">{value}</span>
      ) : (
        <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not available</span>
      )}
    </div>
  );
}

function ResourceBadge({
  label,
  count,
  available,
  future,
  title,
}: {
  label: string;
  count: number | null;
  available: boolean;
  future: boolean;
  title: string;
}) {
  if (future) {
    return (
      <span
        title={title}
        className="text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full cursor-default"
      >
        {label} · Future
      </span>
    );
  }
  if (!available) {
    return (
      <span className="text-xs bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 px-2 py-0.5 rounded-full">
        {label} · Unavailable
      </span>
    );
  }
  return (
    <span
      title={title}
      className="text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full cursor-default"
    >
      {label}{count !== null ? ` · ≥${count}` : " · Available"}
    </span>
  );
}

// ─── Exploration footer ───────────────────────────────────────────────────────

function GeneExplorationFooter({
  meta,
  isLoading,
  pageError,
  retryOffset,
  onLoadMore,
  onRetry,
}: {
  meta: PaginationMeta | null;
  isLoading: boolean;
  pageError: string | null;
  retryOffset: number | null;
  onLoadMore: () => void;
  onRetry: (offset: number) => void;
}) {
  if (pageError) {
    return (
      <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
          ⚠️ Failed to load next page — previous results preserved.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{pageError}</p>
        {retryOffset !== null && (
          <button
            onClick={() => onRetry(retryOffset)}
            disabled={isLoading}
            className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full hover:bg-amber-200 disabled:opacity-50 font-medium transition-colors"
          >
            {isLoading ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>
    );
  }

  if (!meta) return null;

  if (!meta.hasMore && !meta.hitUpstreamLimit && meta.totalCount > 0) {
    return (
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50 text-center">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {meta.totalCount === 1
            ? "One gene record found."
            : `All ${meta.totalCount} gene records shown.`}
        </p>
      </div>
    );
  }

  if (!meta.hasMore && meta.hitUpstreamLimit) {
    return (
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50 text-center">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
          Showing the first {Math.min(meta.totalCount, 9999).toLocaleString()} of{" "}
          {meta.totalCount.toLocaleString()} results
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Narrow your search for more specific gene results.
        </p>
      </div>
    );
  }

  if (meta.hasMore) {
    return (
      <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
        <button
          onClick={onLoadMore}
          disabled={isLoading}
          className="text-xs font-semibold px-4 py-2 rounded-full transition-all disabled:opacity-50 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner />
              Loading…
            </span>
          ) : (
            "Load More Genes"
          )}
        </button>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {meta.totalCount.toLocaleString()} total
        </p>
      </div>
    );
  }

  return null;
}

// ─── Loading spinner ──────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
