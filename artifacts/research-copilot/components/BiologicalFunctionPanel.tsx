"use client";

/**
 * components/BiologicalFunctionPanel.tsx — GO Functional Annotation display (Phase 5.6A)
 *
 * Renders Gene Ontology annotations grouped into three collapsible aspect sections:
 *   - Molecular Function   (GO aspect: molecular_function)
 *   - Biological Process   (GO aspect: biological_process)
 *   - Cellular Component   (GO aspect: cellular_component)
 *
 * LAZY LOAD: GO data is fetched on first expand of the panel header.
 *   No NCBI call is made until the researcher explicitly opens the section.
 *
 * EVIDENCE CODE DISPLAY:
 *   - evidenceCode shown in a chip on each row
 *   - evidenceLabel shown on hover/title (tooltip)
 *   - Computational annotations (IEA and related codes) are visually distinct:
 *     lighter weight, italic term name, "computational" label — not hidden.
 *   - Experimental annotations (EXP, IDA, IMP, etc.) are shown normally.
 *
 * PAGINATION:
 *   Client-side slice within each aspect group (all data in-memory after one fetch).
 *   Groups with > GO_ASPECT_PAGE_SIZE annotations show a "Show More" button.
 *   Reuses the established client-side pagination pattern from TranscriptExplorer.
 *
 * EMPTY / ERROR STATES (per Phase 5.6A §9):
 *   - Each aspect section shows an explicit "no annotations" message when empty —
 *     NOT hidden, because absence of a GO aspect is itself informative.
 *   - Gene not annotated: explicit "no GO annotations" empty state.
 *   - API failure: retry-capable error state; never crashes the parent card.
 *   - Rate limit: specific amber warning (same treatment as Phase 5.5).
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId, geneSymbol, and organism are consumed from the GeneRecord prop.
 *   This component never independently re-resolves any identifier.
 */

import { useState, useRef } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { FunctionalAnnotation } from "@/types/functional-annotation";
import { isComputationalEvidence } from "@/types/functional-annotation";

// ─── Constants ────────────────────────────────────────────────────────────────

const GO_ASPECT_PAGE_SIZE = 20;

// ─── Aspect display config ────────────────────────────────────────────────────

interface AspectConfig {
  key: FunctionalAnnotation["aspect"];
  label: string;
  icon: string;
  colorClass: string;
  badgeClass: string;
}

const ASPECTS: AspectConfig[] = [
  {
    key: "molecular_function",
    label: "Molecular Function",
    icon: "⚙️",
    colorClass: "text-violet-700 dark:text-violet-300",
    badgeClass: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  },
  {
    key: "biological_process",
    label: "Biological Process",
    icon: "🔄",
    colorClass: "text-emerald-700 dark:text-emerald-300",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  {
    key: "cellular_component",
    label: "Cellular Component",
    icon: "🏗️",
    colorClass: "text-sky-700 dark:text-sky-300",
    badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  },
];

// ─── Response shape from /api/gene/go ────────────────────────────────────────

interface GoApiResponse {
  module: string;
  status: "success" | "empty" | "error";
  data: FunctionalAnnotation[];
  count: number;
  error: { code: string; message: string } | null;
  cached: boolean;
  executionTimeMs: number;
  timestamp: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BiologicalFunctionPanelProps {
  gene: GeneRecord;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BiologicalFunctionPanel({ gene }: BiologicalFunctionPanelProps) {
  // ── Panel open/close ────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);

  // ── Fetch state ─────────────────────────────────────────────────────────────
  const [fetchState, setFetchState] = useState<
    "idle" | "loading" | "success" | "empty" | "error"
  >("idle");
  const [annotations, setAnnotations] = useState<FunctionalAnnotation[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRateLimit, setIsRateLimit] = useState(false);

  // ── Per-aspect visible counts (client-side pagination) ──────────────────────
  const [visibleCounts, setVisibleCounts] = useState<
    Record<FunctionalAnnotation["aspect"], number>
  >({
    molecular_function: GO_ASPECT_PAGE_SIZE,
    biological_process: GO_ASPECT_PAGE_SIZE,
    cellular_component: GO_ASPECT_PAGE_SIZE,
  });

  // ── Aspect open/close ───────────────────────────────────────────────────────
  const [openAspects, setOpenAspects] = useState<
    Record<FunctionalAnnotation["aspect"], boolean>
  >({
    molecular_function: true,
    biological_process: true,
    cellular_component: true,
  });

  // ── Fetch guard — only call once ────────────────────────────────────────────
  const fetchedRef = useRef(false);

  // ── Fetch GO annotations ────────────────────────────────────────────────────
  const fetchAnnotations = async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setFetchState("loading");
    setErrorMessage(null);
    setIsRateLimit(false);

    try {
      const res = await fetch("/api/gene/go", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geneId: gene.geneId,
          geneSymbol: gene.officialSymbol,
          organism: gene.organism,
          taxonomyId: gene.taxonomyId,
        }),
      });

      const result: GoApiResponse = await res.json();

      if (result.status === "error") {
        const rateLimited =
          result.error?.code === "RATE_LIMITED" ||
          Boolean(result.error?.message?.includes("429")) ||
          Boolean(result.error?.message?.toLowerCase().includes("rate limit"));
        setIsRateLimit(rateLimited);
        setErrorMessage(
          result.error?.message ?? "Failed to load functional annotations."
        );
        setFetchState("error");
        fetchedRef.current = false; // Allow retry
        return;
      }

      if (result.status === "empty" || result.data.length === 0) {
        setFetchState("empty");
        return;
      }

      setAnnotations(result.data);
      setFetchState("success");
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Network error — could not reach the annotation service."
      );
      setFetchState("error");
      fetchedRef.current = false; // Allow retry
    }
  };

  const handleToggle = () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && fetchState === "idle") {
      fetchAnnotations();
    }
  };

  const handleRetry = () => {
    fetchedRef.current = false;
    setFetchState("loading");
    setErrorMessage(null);
    fetchAnnotations();
  };

  // ── Group annotations by aspect ─────────────────────────────────────────────
  const byAspect: Record<FunctionalAnnotation["aspect"], FunctionalAnnotation[]> = {
    molecular_function: [],
    biological_process: [],
    cellular_component: [],
  };
  for (const ann of annotations) {
    byAspect[ann.aspect].push(ann);
  }

  const totalCount = annotations.length;

  return (
    <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
      {/* ── Panel header / toggle ─────────────────────────────────────────── */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 text-left group"
        aria-expanded={isOpen}
      >
        <span className="text-sm">🧩</span>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide">
          Biological Function
        </p>
        {fetchState === "success" && totalCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
            {totalCount} annotation{totalCount !== 1 ? "s" : ""}
          </span>
        )}
        {fetchState === "loading" && (
          <span className="ml-1 text-slate-400">
            <SmallSpinner />
          </span>
        )}
        <span className="ml-auto text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors text-xs">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* ── Panel body ───────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="space-y-3 pl-1">
          {/* Loading */}
          {fetchState === "loading" && (
            <div className="flex items-center gap-2 py-3">
              <SmallSpinner />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Loading GO annotations…
              </p>
            </div>
          )}

          {/* Error */}
          {fetchState === "error" && (
            <div className="space-y-1.5 py-2">
              {isRateLimit ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ NCBI rate limit hit — functional annotation data temporarily unavailable. Try again in a few seconds.
                </p>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ {errorMessage ?? "Failed to load functional annotations."}
                </p>
              )}
              <button
                onClick={handleRetry}
                className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full hover:bg-amber-200 font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty — gene has no GO annotations */}
          {fetchState === "empty" && (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
              No Gene Ontology annotations found for {gene.officialSymbol} in NCBI Gene.
            </p>
          )}

          {/* Success — aspect groups */}
          {fetchState === "success" && (
            <div className="space-y-3">
              {ASPECTS.map((aspect) => (
                <AspectSection
                  key={aspect.key}
                  config={aspect}
                  annotations={byAspect[aspect.key]}
                  visibleCount={visibleCounts[aspect.key]}
                  isOpen={openAspects[aspect.key]}
                  onToggle={() =>
                    setOpenAspects((prev) => ({
                      ...prev,
                      [aspect.key]: !prev[aspect.key],
                    }))
                  }
                  onShowMore={() =>
                    setVisibleCounts((prev) => ({
                      ...prev,
                      [aspect.key]: prev[aspect.key] + GO_ASPECT_PAGE_SIZE,
                    }))
                  }
                />
              ))}

              <p className="text-xs text-slate-400 dark:text-slate-500 italic pt-1">
                GO annotations from NCBI Gene (GOA). Evidence codes follow GO Consortium standards.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aspect section ───────────────────────────────────────────────────────────

function AspectSection({
  config,
  annotations,
  visibleCount,
  isOpen,
  onToggle,
  onShowMore,
}: {
  config: AspectConfig;
  annotations: FunctionalAnnotation[];
  visibleCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onShowMore: () => void;
}) {
  const total = annotations.length;
  const visible = annotations.slice(0, visibleCount);
  const hasMore = total > visibleCount;

  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-700/60 overflow-hidden">
      {/* Aspect header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/40 text-left hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="text-sm">{config.icon}</span>
        <span className={`text-xs font-semibold ${config.colorClass}`}>
          {config.label}
        </span>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ml-1 ${config.badgeClass}`}
        >
          {total}
        </span>
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* Annotation rows */}
      {isOpen && (
        <div className="divide-y divide-slate-50 dark:divide-slate-700/30">
          {total === 0 ? (
            /* Explicitly show empty aspect — absence is informative */
            <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
              No {config.label.toLowerCase()} annotations in NCBI Gene for this gene.
            </p>
          ) : (
            <>
              {visible.map((ann, idx) => (
                <AnnotationRow key={`${ann.goId}-${ann.evidenceCode}-${idx}`} annotation={ann} />
              ))}
              {/* Show More */}
              {hasMore && (
                <div className="px-3 py-2 flex items-center justify-between">
                  <button
                    onClick={onShowMore}
                    className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${config.badgeClass} hover:opacity-80`}
                  >
                    Show {Math.min(GO_ASPECT_PAGE_SIZE, total - visibleCount)} more
                  </button>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {visibleCount} of {total}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Individual annotation row ────────────────────────────────────────────────

function AnnotationRow({ annotation }: { annotation: FunctionalAnnotation }) {
  const isComputational = isComputationalEvidence(annotation.evidenceCode);

  return (
    <div className="px-3 py-2 flex items-start gap-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
      {/* GO ID — canonical identifier, monospace */}
      <span className="shrink-0 text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5 select-all">
        {annotation.goId}
      </span>

      {/* Term name */}
      <span
        className={`flex-1 text-xs leading-relaxed ${
          isComputational
            ? "text-slate-400 dark:text-slate-500 italic"
            : "text-slate-700 dark:text-slate-200"
        }`}
      >
        {annotation.term}
      </span>

      {/* Evidence code chip with label on hover */}
      <span
        title={annotation.evidenceLabel}
        className={`shrink-0 text-xs font-mono px-1.5 py-0.5 rounded cursor-help ${
          isComputational
            ? "bg-slate-100 dark:bg-slate-700/40 text-slate-400 dark:text-slate-500"
            : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-semibold"
        }`}
      >
        {annotation.evidenceCode}
      </span>
    </div>
  );
}

// ─── Micro spinner ────────────────────────────────────────────────────────────

function SmallSpinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 text-slate-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
