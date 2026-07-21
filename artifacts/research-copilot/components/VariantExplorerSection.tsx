"use client";

/**
 * components/VariantExplorerSection.tsx — Variant Explorer UI (Phase 5.5A + 5.5B-1)
 *
 * Renders a paginated list of ClinVar variants for a gene.
 * Phase 5.5B-1 adds: per-variant clinical evidence expansion (condition interpretations,
 * aggregate classifications, review status, submission detail).
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
 *  - Clinical evidence (5.5B-1): fetched on-demand per variant expansion; one VCV
 *    EFetch call per variant; UI expand/collapse is show/hide of already-fetched data.
 */

import React, { useState, useEffect, useCallback } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { VariantRecord } from "@/types/variant-record";
import type { ModuleResult } from "@/types/module-result";
import type {
  ClinicalEvidence,
  ConditionInterpretation,
  ClinicalSubmission,
} from "@/types/clinical-evidence";

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

// Clinical evidence fetch state per variant
type CEState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; data: ClinicalEvidence }
  | { phase: "empty" }
  | { phase: "error"; message: string };

// API response shape from /api/clinical-evidence
interface CEApiResponse {
  status: "success" | "empty" | "error";
  data: ClinicalEvidence | null;
  error: { code: string; message: string } | null;
  cached: boolean;
}

// ── API calls ──────────────────────────────────────────────────────────────────

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

async function fetchClinicalEvidence(
  clinvarVariationId: string,
  clinvarAccession: string | null,
  taxonomyId: string
): Promise<CEApiResponse> {
  const res = await fetch("/api/clinical-evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinvarVariationId, clinvarAccession, taxonomyId }),
  });
  if (!res.ok) throw new Error(`Clinical evidence HTTP ${res.status}`);
  return res.json() as Promise<CEApiResponse>;
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
  return variantType.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Color class for a ClinVar aggregate or submitted classification text. */
function classificationBadgeClass(value: string | null): string {
  if (!value) return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  const v = value.toLowerCase();
  if (v === "pathogenic") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (v === "likely pathogenic") return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
  if (v === "benign") return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
  if (v === "likely benign") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (v.includes("uncertain") || v.includes("vus")) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200";
  if (v.includes("conflicting")) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (v === "not provided" || v === "not classified" || v === "no classification provided")
    return "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
}

/** Compute submission classification counts for display grouping (never a synthesized final verdict). */
function groupSubmissionClassifications(
  submissions: readonly ClinicalSubmission[]
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of submissions) {
    const label = s.significance ?? "Not provided";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Sort by count descending
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-3 w-3 ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Clinical Evidence sub-components ──────────────────────────────────────────

/** Renders one SCV submission as a compact row. */
function SubmissionRow({ sub }: { sub: ClinicalSubmission }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs py-1.5 border-b border-slate-100 dark:border-slate-700/40 last:border-0">
      <span className="text-slate-400 dark:text-slate-500 font-mono">{sub.scvAccession}</span>
      <div className="space-y-0.5">
        {sub.submitter && (
          <p className="text-slate-600 dark:text-slate-300 font-medium truncate">{sub.submitter}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {sub.significance && (
            <span
              className={`text-xs px-1.5 py-0 rounded-full font-medium ${classificationBadgeClass(sub.significance)}`}
            >
              {sub.significance}
            </span>
          )}
          {sub.reviewStatus && (
            <span className="text-xs text-slate-400 dark:text-slate-500 italic">
              {sub.reviewStatus}
            </span>
          )}
          {sub.lastEvaluated && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {sub.lastEvaluated}
            </span>
          )}
          {!sub.contributesToAggregate && (
            <span className="text-xs text-slate-300 dark:text-slate-600 italic">(not contributing)</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders one ConditionInterpretation (one RCV) with its classification, review status, and submissions. */
function ConditionInterpretationBlock({
  interp,
  submissionsExpanded,
  onToggleSubmissions,
}: {
  interp: ConditionInterpretation;
  submissionsExpanded: boolean;
  onToggleSubmissions: () => void;
}) {
  const classGroups = groupSubmissionClassifications(interp.submissions);
  const conditionNames = interp.conditions.map((c) => c.name).join("; ");

  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/20 p-3 space-y-2">
      {/* Condition name */}
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
          {conditionNames || "Unspecified condition"}
        </span>
        <a
          href={`https://www.ncbi.nlm.nih.gov/clinvar/${interp.rcvAccession}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-violet-500 dark:text-violet-400 hover:underline font-mono"
        >
          {interp.rcvAccession}
        </a>
      </div>

      {/* ClinVar's own aggregate classification — labeled explicitly */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 dark:text-slate-500">ClinVar aggregate:</span>
        {interp.aggregateClassification ? (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${classificationBadgeClass(
              interp.aggregateClassification
            )}`}
          >
            {interp.aggregateClassification}
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not provided</span>
        )}
        {interp.lastEvaluated && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            (evaluated {interp.lastEvaluated})
          </span>
        )}
      </div>

      {/* Review status — plain text, no stars (5.5B-2 adds stars) */}
      {interp.aggregateReviewStatus && (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">
          Review status: {interp.aggregateReviewStatus}
        </p>
      )}

      {/* Submission classification counts — display grouping only, not a synthesized verdict */}
      {classGroups.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400 dark:text-slate-500">Submissions:</span>
          {classGroups.map(({ label, count }) => (
            <span
              key={label}
              className={`text-xs px-1.5 py-0 rounded-full font-medium ${classificationBadgeClass(label)}`}
              title="Display grouping only — ClinVar's aggregate classification above is the authoritative interpretation"
            >
              {count} {label}
            </span>
          ))}
        </div>
      )}

      {/* Submissions expand/collapse — UI-only toggle, no new network call */}
      {interp.submissions.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleSubmissions}
            className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          >
            {submissionsExpanded
              ? `Hide ${interp.submissions.length} submission${interp.submissions.length !== 1 ? "s" : ""}`
              : `Show ${interp.submissions.length} submission${interp.submissions.length !== 1 ? "s" : ""} (${interp.submissionCount} in ClinVar)`}
          </button>

          {submissionsExpanded && (
            <div className="mt-2 space-y-0 rounded border border-slate-100 dark:border-slate-700/40 bg-white dark:bg-slate-800/30 px-2 py-1">
              {interp.submissions.map((sub) => (
                <SubmissionRow key={sub.scvAccession} sub={sub} />
              ))}
            </div>
          )}
        </div>
      )}

      {interp.submissions.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No individual submission records parsed for this condition.
        </p>
      )}
    </div>
  );
}

/** Renders the full ClinicalEvidence panel for an expanded variant row. */
function ClinicalEvidencePanel({
  ceState,
  expandedRcvs,
  onToggleRcv,
}: {
  ceState: CEState;
  expandedRcvs: Set<string>;
  onToggleRcv: (rcvAccession: string) => void;
}) {
  const baseClass =
    "mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/40 space-y-2";

  if (ceState.phase === "loading") {
    return (
      <div className={`${baseClass} flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500`}>
        <LoadingSpinner />
        Loading clinical evidence…
      </div>
    );
  }

  if (ceState.phase === "error") {
    const isRateLimit = ceState.message.toLowerCase().includes("rate limit");
    return (
      <div className={`${baseClass}`}>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚠️{" "}
          {isRateLimit
            ? "NCBI rate limit reached — please try again in a moment."
            : `Clinical evidence unavailable: ${ceState.message}`}
        </p>
      </div>
    );
  }

  if (ceState.phase === "empty") {
    return (
      <div className={`${baseClass}`}>
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No formal ClinVar interpretations on record for this variant.
        </p>
      </div>
    );
  }

  if (ceState.phase !== "loaded") return null;

  const { data } = ceState;

  if (data.interpretations.length === 0) {
    return (
      <div className={`${baseClass}`}>
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          No formal ClinVar interpretations on record for this variant.
        </p>
      </div>
    );
  }

  return (
    <div className={`${baseClass}`}>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        Clinical Evidence ({data.interpretations.length} condition
        {data.interpretations.length !== 1 ? "s" : ""})
      </p>
      <div className="space-y-2">
        {data.interpretations.map((interp) => (
          <ConditionInterpretationBlock
            key={interp.rcvAccession}
            interp={interp}
            submissionsExpanded={expandedRcvs.has(interp.rcvAccession)}
            onToggleSubmissions={() => onToggleRcv(interp.rcvAccession)}
          />
        ))}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Source:{" "}
        <a
          href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${data.clinvarVariationId}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline text-violet-500 dark:text-violet-400"
        >
          ClinVar
        </a>{" "}
        (NCBI) — classifications and review status preserved as-is from source.
      </p>
    </div>
  );
}

// ── Variant row ────────────────────────────────────────────────────────────────

function VariantRow({
  variant,
  isExpanded,
  onToggle,
  ceState,
  expandedRcvs,
  onToggleRcv,
}: {
  variant: VariantRecord;
  isExpanded: boolean;
  onToggle: () => void;
  ceState: CEState | undefined;
  expandedRcvs: Set<string>;
  onToggleRcv: (rcvAccession: string) => void;
}) {
  const consequence = variant.transcriptConsequences[0] ?? null;
  const hasConsequence = consequence !== null;
  const currentCeState = ceState ?? { phase: "idle" as const };
  const isCeLoading = currentCeState.phase === "loading";

  return (
    <div
      className={`rounded-lg border bg-white dark:bg-slate-800/30 px-4 py-3 space-y-1.5 transition-colors ${
        isExpanded
          ? "border-violet-200 dark:border-violet-700/50"
          : "border-slate-100 dark:border-slate-700/60 hover:border-violet-200 dark:hover:border-violet-700/50"
      }`}
    >
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

      {/* Identifiers row + clinical evidence toggle */}
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

        {/* Clinical evidence expand toggle */}
        <button
          type="button"
          onClick={onToggle}
          disabled={isCeLoading}
          className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors disabled:opacity-60 disabled:cursor-wait"
          aria-expanded={isExpanded}
          aria-label="Toggle clinical evidence"
        >
          {isCeLoading ? (
            <>
              <LoadingSpinner />
              Loading…
            </>
          ) : (
            <>
              Clinical Evidence
              <svg
                className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Clinical evidence panel — shown when expanded */}
      {isExpanded && currentCeState.phase !== "idle" && (
        <ClinicalEvidencePanel
          ceState={currentCeState}
          expandedRcvs={expandedRcvs}
          onToggleRcv={onToggleRcv}
        />
      )}
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

  // Clinical evidence state (5.5B-1)
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(null);
  const [ceMap, setCeMap] = useState<Map<string, CEState>>(new Map());
  // Per-condition submission panels open within the currently-expanded variant
  const [expandedRcvs, setExpandedRcvs] = useState<Set<string>>(new Set());

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
      // Collapse any open CE panel on filter change
      setExpandedVariantId(null);
      setExpandedRcvs(new Set());

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

  // Toggle clinical evidence for a variant (5.5B-1)
  const handleVariantToggle = useCallback(
    async (variant: VariantRecord) => {
      const vid = variant.clinvarVariationId;

      // Collapse if already expanded
      if (expandedVariantId === vid) {
        setExpandedVariantId(null);
        setExpandedRcvs(new Set());
        return;
      }

      // Expand (reset submission panels for new variant)
      setExpandedVariantId(vid);
      setExpandedRcvs(new Set());

      // Skip fetch if already loaded (any terminal state)
      const current = ceMap.get(vid);
      if (current && current.phase !== "idle") return;

      // Mark loading
      setCeMap((prev) => new Map(prev).set(vid, { phase: "loading" }));

      try {
        const response = await fetchClinicalEvidence(
          vid,
          variant.clinvarAccession ?? null,
          gene.taxonomyId
        );

        if (response.status === "empty" || (response.data && response.data.interpretations.length === 0)) {
          setCeMap((prev) => new Map(prev).set(vid, { phase: "empty" }));
        } else if (response.status === "success" && response.data) {
          setCeMap((prev) => new Map(prev).set(vid, { phase: "loaded", data: response.data! }));
        } else {
          setCeMap((prev) =>
            new Map(prev).set(vid, {
              phase: "error",
              message: response.error?.message ?? "Failed to load clinical evidence.",
            })
          );
        }
      } catch (err) {
        setCeMap((prev) =>
          new Map(prev).set(vid, {
            phase: "error",
            message: err instanceof Error ? err.message : "Failed to load clinical evidence.",
          })
        );
      }
    },
    [expandedVariantId, ceMap, gene.taxonomyId]
  );

  const handleToggleRcv = useCallback((rcvAccession: string) => {
    setExpandedRcvs((prev) => {
      const next = new Set(prev);
      if (next.has(rcvAccession)) next.delete(rcvAccession);
      else next.add(rcvAccession);
      return next;
    });
  }, []);

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
            <VariantRow
              key={v.clinvarVariationId}
              variant={v}
              isExpanded={expandedVariantId === v.clinvarVariationId}
              onToggle={() => handleVariantToggle(v)}
              ceState={ceMap.get(v.clinvarVariationId)}
              expandedRcvs={expandedVariantId === v.clinvarVariationId ? expandedRcvs : new Set()}
              onToggleRcv={handleToggleRcv}
            />
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
          (NCBI). Clinical evidence expands per variant — classifications preserved as-is from ClinVar.
        </p>
      )}
    </div>
  );
}
