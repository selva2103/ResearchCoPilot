"use client";

/**
 * components/VariantExplorerSection.tsx — Variant Explorer UI (Phase 5.5A)
 *
 * Renders a paginated list of ClinVar variants for a gene.
 *
 * Design principles:
 *  - Lazy load: variants fetched on mount (section only renders for the primary gene
 *    when gene.variants.available is true)
 *  - Server-side pagination: Load More calls POST /api/variant/list with offset
 *  - Filters: clinical significance + variant type (ClinVar ESearch server-side filters)
 *  - No N+1: page 1 = 2 NCBI calls (ESearch + ESummary batch), Load More = 2 calls each
 *  - Non-human guard: non-9606 taxonomyId shows explicit unsupported state
 *  - Error states: network errors, NCBI failures, non-human organism
 *  - Empty states: no variants found for gene / filter combination
 *  - hitUpstreamLimit: shown when NCBI ESearch ceiling (9999) is reached
 *
 * 5.5B handoff: Clinical significance, review status, and conflict flags belong
 * to Phase 5.5B ClinicalEvidence. They are intentionally absent here.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { VariantRecord } from "@/types/variant-record";
import type { ModuleResult } from "@/types/module-result";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;

// ── Sub-types ──────────────────────────────────────────────────────────────────

type SigFilter =
  | ""
  | "pathogenic"
  | "likely pathogenic"
  | "benign"
  | "likely benign"
  | "uncertain significance";

type TypeFilter =
  | ""
  | "single nucleotide variant"
  | "deletion"
  | "insertion"
  | "indel"
  | "duplication";

// ── API call ───────────────────────────────────────────────────────────────────

async function fetchVariants(
  geneId: string,
  taxonomyId: string,
  offset: number,
  pageSize: number,
  significanceFilter: string,
  variantTypeFilter: string
): Promise<ModuleResult<VariantRecord>> {
  const res = await fetch("/api/variant/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geneId,
      taxonomyId,
      offset,
      pageSize,
      significanceFilter: significanceFilter || null,
      variantTypeFilter: variantTypeFilter || null,
      sort: "default",
    }),
  });
  if (!res.ok) throw new Error(`Variant list HTTP ${res.status}`);
  return res.json() as Promise<ModuleResult<VariantRecord>>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function variantTypeBadgeColor(variantType: string | null): string {
  if (!variantType) return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  const t = variantType.toLowerCase();
  if (t.includes("single nucleotide")) return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  if (t.includes("deletion")) return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (t.includes("insertion")) return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
  if (t.includes("indel")) return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
  if (t.includes("duplication")) return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200";
  if (t.includes("copy number")) return "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
}

/**
 * Map ClinVar raw variant type strings to human-readable abbreviations.
 * Raw ClinVar strings are lowercase and verbose (e.g. "single nucleotide variant").
 * Displayed in the colored badge only — raw value still used for filtering.
 */
function variantTypeLabel(variantType: string | null): string {
  if (!variantType) return "Unknown";
  const t = variantType.toLowerCase();
  if (t.includes("single nucleotide")) return "SNV";
  if (t === "indel") return "Indel";
  if (t.includes("deletion")) return "Deletion";
  if (t.includes("insertion")) return "Insertion";
  if (t.includes("duplication")) return "Duplication";
  if (t.includes("copy number variant") || t.includes("copy number variation")) return "CNV";
  if (t.includes("inversion")) return "Inversion";
  if (t.includes("microsatellite")) return "Microsatellite";
  // Fallback: title-case the raw string
  return variantType.replace(/\b\w/g, (c) => c.toUpperCase());
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Variant row ────────────────────────────────────────────────────────────────

function VariantRow({ variant }: { variant: VariantRecord }) {
  const consequence = variant.transcriptConsequences[0] ?? null;
  const hasConsequence = consequence !== null;

  return (
    <div className="group rounded-lg border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800/30 px-4 py-3 space-y-1.5 hover:border-violet-200 dark:hover:border-violet-700/50 transition-colors">
      {/* Row header: type badge + title */}
      <div className="flex items-start gap-2 flex-wrap">
        {variant.variantType && (
          <span
            className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${variantTypeBadgeColor(
              variant.variantType
            )}`}
            title={variant.variantType ?? undefined}
          >
            {variantTypeLabel(variant.variantType)}
          </span>
        )}
        <span className="text-xs text-slate-700 dark:text-slate-300 font-mono leading-relaxed break-all">
          {variant.title ?? variant.clinvarVariationId}
        </span>
      </div>

      {/* Transcript consequence (representative) */}
      {hasConsequence && (
        <div className="pl-1 space-y-0.5">
          {consequence.hgvsCoding && (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span className="text-slate-400 dark:text-slate-500 mr-1">cDNA</span>
              {consequence.transcriptAccession}:{consequence.hgvsCoding}
            </p>
          )}
          {consequence.hgvsProtein && (
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span className="text-slate-400 dark:text-slate-500 mr-1">Protein</span>
              {consequence.hgvsProtein}
            </p>
          )}
        </div>
      )}

      {/* Molecular consequences */}
      {variant.molecularConsequences.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pl-1">
          {variant.molecularConsequences.slice(0, 3).map((c) => (
            <span
              key={c}
              className="text-xs px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600/50"
            >
              {c}
            </span>
          ))}
          {variant.molecularConsequences.length > 3 && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              +{variant.molecularConsequences.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Identifiers row */}
      <div className="flex items-center gap-3 flex-wrap pl-1">
        <a
          href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${variant.clinvarVariationId}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-600 dark:text-violet-400 hover:underline font-mono"
          title="View in ClinVar"
        >
          {variant.clinvarAccession ?? `VCV${variant.clinvarVariationId}`}
        </a>
        {variant.dbsnpId && (
          <a
            href={`https://www.ncbi.nlm.nih.gov/snp/rs${variant.dbsnpId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 dark:text-blue-400 hover:underline font-mono"
            title="View in dbSNP"
          >
            rs{variant.dbsnpId}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Filter controls ────────────────────────────────────────────────────────────

function FilterControls({
  sigFilter,
  typeFilter,
  onSigChange,
  onTypeChange,
  disabled,
}: {
  sigFilter: SigFilter;
  typeFilter: TypeFilter;
  onSigChange: (v: SigFilter) => void;
  onTypeChange: (v: TypeFilter) => void;
  disabled: boolean;
}) {
  const selectClass =
    "text-xs border border-slate-200 dark:border-slate-600 rounded px-2 py-1 " +
    "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 " +
    "focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Filter:</span>
      <select
        value={sigFilter}
        onChange={(e) => onSigChange(e.target.value as SigFilter)}
        disabled={disabled}
        className={selectClass}
        aria-label="Filter by clinical significance"
      >
        <option value="">All significance</option>
        <option value="pathogenic">Pathogenic</option>
        <option value="likely pathogenic">Likely pathogenic</option>
        <option value="uncertain significance">Uncertain significance</option>
        <option value="likely benign">Likely benign</option>
        <option value="benign">Benign</option>
      </select>
      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value as TypeFilter)}
        disabled={disabled}
        className={selectClass}
        aria-label="Filter by variant type"
      >
        <option value="">All types</option>
        <option value="single nucleotide variant">SNV</option>
        <option value="deletion">Deletion</option>
        <option value="insertion">Insertion</option>
        <option value="indel">Indel</option>
        <option value="duplication">Duplication</option>
      </select>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function VariantExplorerSection({ gene }: { gene: GeneRecord }) {
  const isHuman = gene.taxonomyId === "9606";

  const [sigFilter, setSigFilter] = useState<SigFilter>("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");

  // Accumulated variant records across all loaded pages
  const [variants, setVariants] = useState<VariantRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number>(0);
  const [hitUpstreamLimit, setHitUpstreamLimit] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Load page 1 (or refresh on filter change)
  const loadPage1 = useCallback(
    async (sig: SigFilter, type: TypeFilter) => {
      setIsLoading(true);
      setError(null);
      setVariants([]);
      setTotalCount(null);
      setHasMore(false);
      setNextOffset(0);
      setHitUpstreamLimit(false);

      try {
        const result = await fetchVariants(
          gene.geneId,
          gene.taxonomyId,
          0,
          DEFAULT_PAGE_SIZE,
          sig,
          type
        );

        if (result.error?.code === "NON_HUMAN_ORGANISM") {
          setError("non_human");
          return;
        }

        if (result.status === "error") {
          setError(result.error?.message ?? "Failed to load variants.");
          return;
        }

        setVariants(result.data);
        setTotalCount(result.totalCount ?? null);
        setHasMore(result.hasMore ?? false);
        setNextOffset(result.nextOffset ?? result.data.length);
        setHitUpstreamLimit(result.hitUpstreamLimit ?? false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Variant data temporarily unavailable.");
      } finally {
        setIsLoading(false);
        setInitialLoaded(true);
      }
    },
    [gene.geneId, gene.taxonomyId]
  );

  // Load more pages
  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const result = await fetchVariants(
        gene.geneId,
        gene.taxonomyId,
        nextOffset,
        DEFAULT_PAGE_SIZE,
        sigFilter,
        typeFilter
      );

      if (result.status !== "error") {
        setVariants((prev) => [...prev, ...result.data]);
        setHasMore(result.hasMore ?? false);
        setNextOffset(result.nextOffset ?? nextOffset + result.data.length);
        setHitUpstreamLimit(result.hitUpstreamLimit ?? false);
      }
    } catch {
      // Don't replace existing data on load-more failure; just stop
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Initial load on mount
  useEffect(() => {
    loadPage1(sigFilter, typeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload on filter change (after initial load)
  const handleSigChange = (v: SigFilter) => {
    setSigFilter(v);
    loadPage1(v, typeFilter);
  };
  const handleTypeChange = (v: TypeFilter) => {
    setTypeFilter(v);
    loadPage1(sigFilter, v);
  };

  // ── Non-human guard ───────────────────────────────────────────────────────
  if (!isHuman) {
    return (
      <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🧬</span>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide">
            Variant Explorer
          </p>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          ClinVar variant data is available for human genes only (Homo sapiens).
          This gene is annotated for{" "}
          <span className="font-medium text-slate-500 dark:text-slate-400">
            {gene.organism}
          </span>
          .
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm">🧬</span>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide">
          Variant Explorer
        </p>
        {totalCount !== null && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
            {totalCount.toLocaleString()} variant{totalCount !== 1 ? "s" : ""} in ClinVar
          </span>
        )}
        {isLoading && (
          <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
            <LoadingSpinner />
            Loading…
          </span>
        )}
      </div>

      {/* Filter controls */}
      {initialLoaded && error !== "non_human" && (
        <FilterControls
          sigFilter={sigFilter}
          typeFilter={typeFilter}
          onSigChange={handleSigChange}
          onTypeChange={handleTypeChange}
          disabled={isLoading}
        />
      )}

      {/* Error state */}
      {error && error !== "non_human" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠️ {error}
        </p>
      )}

      {/* Empty state */}
      {initialLoaded && !isLoading && !error && variants.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          {sigFilter || typeFilter
            ? "No variants match the current filter combination."
            : "No ClinVar variants found for this gene."}
        </p>
      )}

      {/* Variant list */}
      {variants.length > 0 && (
        <div className="space-y-2">
          {variants.map((v) => (
            <VariantRow key={v.clinvarVariationId} variant={v} />
          ))}
        </div>
      )}

      {/* NCBI upstream limit notice */}
      {hitUpstreamLimit && (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-1 italic">
          Showing the first{" "}
          <span className="font-medium">9,999</span> of{" "}
          {totalCount !== null
            ? totalCount.toLocaleString()
            : "all"}{" "}
          variants — NCBI ESearch limit reached. Use filters to narrow results.
        </p>
      )}

      {/* Load More button */}
      {hasMore && !hitUpstreamLimit && (
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={loadMore}
            disabled={isLoadingMore}
            className="text-xs font-semibold px-4 py-2 rounded-full transition-all disabled:opacity-50 disabled:cursor-wait bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50"
          >
            {isLoadingMore ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner />
                Loading…
              </span>
            ) : (
              "Load More Variants"
            )}
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {variants.length.toLocaleString()} of{" "}
            {totalCount !== null ? Math.min(totalCount, 9999).toLocaleString() : "…"}
          </p>
        </div>
      )}

      {/* Exhausted state — after pagination was used */}
      {initialLoaded &&
        !hasMore &&
        !hitUpstreamLimit &&
        variants.length > DEFAULT_PAGE_SIZE && (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center pt-1">
            All {variants.length.toLocaleString()} variants loaded
          </p>
        )}

      {/* Data source attribution */}
      {initialLoaded && variants.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Source:{" "}
          <a
            href={`https://www.ncbi.nlm.nih.gov/clinvar/?term=${gene.geneId}[Gene+ID]`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-violet-500 dark:text-violet-400"
          >
            ClinVar
          </a>{" "}
          (NCBI). Identity view only — clinical assertions in Phase 5.5B.
        </p>
      )}
    </div>
  );
}
