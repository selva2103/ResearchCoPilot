"use client";

/**
 * components/BiologicalFunctionPanel.tsx — Biological Function display (Phase 5.6A + 5.6B)
 *
 * Phase 5.6A (GO Foundation):
 *   Renders Gene Ontology annotations grouped into three collapsible aspect sections:
 *   - Molecular Function / Biological Process / Cellular Component
 *   Source: NCBI Gene EFetch XML via /api/gene/go
 *
 * Phase 5.6B (Pathway Integration):
 *   Adds a "Pathways" subsection alongside the GO aspects — NOT merged into them.
 *   Source: Reactome Analysis Service via /api/gene/pathways
 *   Flat list grouped by source (reactome), linked to Reactome PathwayBrowser.
 *   Pagination: 20 per page (TP53 has 129 pathways — warranted per Step 6 check).
 *
 * LAZY LOAD:
 *   Both GO and Pathway fetches are triggered on first panel open.
 *   No network call is made until the researcher explicitly expands the section.
 *   Each subsection has independent loading/error/retry state.
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId, geneSymbol, and organism are consumed from the GeneRecord prop.
 *   This component never independently re-resolves any identifier.
 */

import { useState, useRef } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { FunctionalAnnotation } from "@/types/functional-annotation";
import { isComputationalEvidence } from "@/types/functional-annotation";
import type { PathwayMembership } from "@/types/pathway-membership";

// ─── Constants ────────────────────────────────────────────────────────────────

const GO_ASPECT_PAGE_SIZE = 20;
const PATHWAY_PAGE_SIZE = 20;

// ─── GO Aspect display config ─────────────────────────────────────────────────

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
    badgeClass:
      "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  },
  {
    key: "biological_process",
    label: "Biological Process",
    icon: "🔄",
    colorClass: "text-emerald-700 dark:text-emerald-300",
    badgeClass:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  {
    key: "cellular_component",
    label: "Cellular Component",
    icon: "🏗️",
    colorClass: "text-sky-700 dark:text-sky-300",
    badgeClass:
      "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  },
];

// ─── API response shapes ──────────────────────────────────────────────────────

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

interface PathwaysApiResponse {
  module: string;
  status: "success" | "empty" | "error";
  data: PathwayMembership[];
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

export default function BiologicalFunctionPanel({
  gene,
}: BiologicalFunctionPanelProps) {
  // ── Panel open/close ────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);

  // ── GO fetch state ──────────────────────────────────────────────────────────
  const [goState, setGoState] = useState<
    "idle" | "loading" | "success" | "empty" | "error"
  >("idle");
  const [annotations, setAnnotations] = useState<FunctionalAnnotation[]>([]);
  const [goError, setGoError] = useState<string | null>(null);
  const [goIsRateLimit, setGoIsRateLimit] = useState(false);
  const goFetchedRef = useRef(false);

  // ── Pathway fetch state ─────────────────────────────────────────────────────
  const [pathwayState, setPathwayState] = useState<
    "idle" | "loading" | "success" | "empty" | "error"
  >("idle");
  const [pathways, setPathways] = useState<PathwayMembership[]>([]);
  const [pathwayError, setPathwayError] = useState<string | null>(null);
  const [pathwayIsRateLimit, setPathwayIsRateLimit] = useState(false);
  const pathwayFetchedRef = useRef(false);

  // ── GO per-aspect visible counts (client-side pagination) ───────────────────
  const [visibleCounts, setVisibleCounts] = useState<
    Record<FunctionalAnnotation["aspect"], number>
  >({
    molecular_function: GO_ASPECT_PAGE_SIZE,
    biological_process: GO_ASPECT_PAGE_SIZE,
    cellular_component: GO_ASPECT_PAGE_SIZE,
  });

  // ── GO aspect open/close ────────────────────────────────────────────────────
  const [openAspects, setOpenAspects] = useState<
    Record<FunctionalAnnotation["aspect"], boolean>
  >({
    molecular_function: true,
    biological_process: true,
    cellular_component: true,
  });

  // ── Pathway visible count (client-side pagination) ──────────────────────────
  const [pathwayVisibleCount, setPathwayVisibleCount] =
    useState(PATHWAY_PAGE_SIZE);

  // ── Pathway subsection open/close ───────────────────────────────────────────
  const [pathwaySubOpen, setPathwaySubOpen] = useState(true);

  // ── Fetch GO annotations ────────────────────────────────────────────────────
  const fetchGoAnnotations = async () => {
    if (goFetchedRef.current) return;
    goFetchedRef.current = true;
    setGoState("loading");
    setGoError(null);
    setGoIsRateLimit(false);

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
          Boolean(
            result.error?.message?.toLowerCase().includes("rate limit"),
          );
        setGoIsRateLimit(rateLimited);
        setGoError(
          result.error?.message ?? "Failed to load functional annotations.",
        );
        setGoState("error");
        goFetchedRef.current = false;
        return;
      }

      if (result.status === "empty" || result.data.length === 0) {
        setGoState("empty");
        return;
      }

      setAnnotations(result.data);
      setGoState("success");
    } catch (err) {
      setGoError(
        err instanceof Error
          ? err.message
          : "Network error — could not reach the annotation service.",
      );
      setGoState("error");
      goFetchedRef.current = false;
    }
  };

  // ── Fetch pathway memberships ───────────────────────────────────────────────
  const fetchPathways = async () => {
    if (pathwayFetchedRef.current) return;
    pathwayFetchedRef.current = true;
    setPathwayState("loading");
    setPathwayError(null);
    setPathwayIsRateLimit(false);

    try {
      const res = await fetch("/api/gene/pathways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geneId: gene.geneId,
          geneSymbol: gene.officialSymbol,
          organism: gene.organism,
        }),
      });

      const result: PathwaysApiResponse = await res.json();

      if (result.status === "error") {
        const rateLimited =
          result.error?.code === "RATE_LIMITED" ||
          Boolean(result.error?.message?.includes("429")) ||
          Boolean(
            result.error?.message?.toLowerCase().includes("rate limit"),
          );
        setPathwayIsRateLimit(rateLimited);
        setPathwayError(
          result.error?.message ?? "Failed to load pathway memberships.",
        );
        setPathwayState("error");
        pathwayFetchedRef.current = false;
        return;
      }

      if (result.status === "empty" || result.data.length === 0) {
        setPathwayState("empty");
        return;
      }

      setPathways(result.data);
      setPathwayState("success");
    } catch (err) {
      setPathwayError(
        err instanceof Error
          ? err.message
          : "Network error — could not reach the pathway service.",
      );
      setPathwayState("error");
      pathwayFetchedRef.current = false;
    }
  };

  // ── Panel toggle — triggers both fetches on first open ─────────────────────
  const handleToggle = () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening) {
      if (goState === "idle") fetchGoAnnotations();
      if (pathwayState === "idle") fetchPathways();
    }
  };

  // ── Group GO annotations by aspect ─────────────────────────────────────────
  const byAspect: Record<
    FunctionalAnnotation["aspect"],
    FunctionalAnnotation[]
  > = {
    molecular_function: [],
    biological_process: [],
    cellular_component: [],
  };
  for (const ann of annotations) {
    byAspect[ann.aspect].push(ann);
  }

  const totalGoCount = annotations.length;
  const totalPathwayCount = pathways.length;
  const isAnyLoading = goState === "loading" || pathwayState === "loading";

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
        {goState === "success" && totalGoCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
            {totalGoCount} GO
          </span>
        )}
        {pathwayState === "success" && totalPathwayCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
            {totalPathwayCount} pathways
          </span>
        )}
        {isAnyLoading && (
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
        <div className="space-y-4 pl-1">
          {/* ────────────── GO ANNOTATIONS SECTION ────────────────────── */}
          <GoAnnotationsSection
            gene={gene}
            state={goState}
            annotations={annotations}
            byAspect={byAspect}
            totalCount={totalGoCount}
            errorMessage={goError}
            isRateLimit={goIsRateLimit}
            visibleCounts={visibleCounts}
            openAspects={openAspects}
            onRetry={() => {
              goFetchedRef.current = false;
              setGoState("loading");
              setGoError(null);
              fetchGoAnnotations();
            }}
            onToggleAspect={(key) =>
              setOpenAspects((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            onShowMore={(key) =>
              setVisibleCounts((prev) => ({
                ...prev,
                [key]: prev[key] + GO_ASPECT_PAGE_SIZE,
              }))
            }
          />

          {/* ────────────── PATHWAYS SECTION ──────────────────────────── */}
          <PathwaysSection
            gene={gene}
            state={pathwayState}
            pathways={pathways}
            totalCount={totalPathwayCount}
            errorMessage={pathwayError}
            isRateLimit={pathwayIsRateLimit}
            visibleCount={pathwayVisibleCount}
            isSubOpen={pathwaySubOpen}
            onToggleSub={() => setPathwaySubOpen((v) => !v)}
            onRetry={() => {
              pathwayFetchedRef.current = false;
              setPathwayState("loading");
              setPathwayError(null);
              fetchPathways();
            }}
            onShowMore={() =>
              setPathwayVisibleCount((n) => n + PATHWAY_PAGE_SIZE)
            }
          />
        </div>
      )}
    </div>
  );
}

// ─── GO Annotations Section ────────────────────────────────────────────────────

function GoAnnotationsSection({
  gene,
  state,
  annotations,
  byAspect,
  totalCount,
  errorMessage,
  isRateLimit,
  visibleCounts,
  openAspects,
  onRetry,
  onToggleAspect,
  onShowMore,
}: {
  gene: GeneRecord;
  state: "idle" | "loading" | "success" | "empty" | "error";
  annotations: FunctionalAnnotation[];
  byAspect: Record<FunctionalAnnotation["aspect"], FunctionalAnnotation[]>;
  totalCount: number;
  errorMessage: string | null;
  isRateLimit: boolean;
  visibleCounts: Record<FunctionalAnnotation["aspect"], number>;
  openAspects: Record<FunctionalAnnotation["aspect"], boolean>;
  onRetry: () => void;
  onToggleAspect: (key: FunctionalAnnotation["aspect"]) => void;
  onShowMore: (key: FunctionalAnnotation["aspect"]) => void;
}) {
  return (
    <div className="space-y-2">
      {/* Section label */}
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        Gene Ontology
      </p>

      {state === "loading" && (
        <div className="flex items-center gap-2 py-2">
          <SmallSpinner />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Loading GO annotations…
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="space-y-1.5 py-1">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {isRateLimit
              ? "⚠️ NCBI rate limit hit — GO data temporarily unavailable. Try again in a few seconds."
              : `⚠️ ${errorMessage ?? "Failed to load functional annotations."}`}
          </p>
          <button
            onClick={onRetry}
            className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full hover:bg-amber-200 font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {state === "empty" && (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
          No Gene Ontology annotations found for {gene.officialSymbol} in NCBI
          Gene.
        </p>
      )}

      {state === "success" && (
        <div className="space-y-2">
          {ASPECTS.map((aspect) => (
            <AspectSection
              key={aspect.key}
              config={aspect}
              annotations={byAspect[aspect.key]}
              visibleCount={visibleCounts[aspect.key]}
              isOpen={openAspects[aspect.key]}
              onToggle={() => onToggleAspect(aspect.key)}
              onShowMore={() => onShowMore(aspect.key)}
            />
          ))}
          <p className="text-xs text-slate-400 dark:text-slate-500 italic pt-0.5">
            GO annotations from NCBI Gene (GOA). Evidence codes follow GO
            Consortium standards.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Pathways Section ─────────────────────────────────────────────────────────

function PathwaysSection({
  gene,
  state,
  pathways,
  totalCount,
  errorMessage,
  isRateLimit,
  visibleCount,
  isSubOpen,
  onToggleSub,
  onRetry,
  onShowMore,
}: {
  gene: GeneRecord;
  state: "idle" | "loading" | "success" | "empty" | "error";
  pathways: PathwayMembership[];
  totalCount: number;
  errorMessage: string | null;
  isRateLimit: boolean;
  visibleCount: number;
  isSubOpen: boolean;
  onToggleSub: () => void;
  onRetry: () => void;
  onShowMore: () => void;
}) {
  const visible = pathways.slice(0, visibleCount);
  const hasMore = totalCount > visibleCount;

  return (
    <div className="space-y-2">
      {/* Section header */}
      <button
        onClick={onToggleSub}
        className="w-full flex items-center gap-2 text-left group"
        aria-expanded={isSubOpen}
        disabled={state === "loading" || state === "idle"}
      >
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          Pathways
        </p>
        {state === "success" && totalCount > 0 && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
            {totalCount}
          </span>
        )}
        {state === "loading" && (
          <span className="ml-1 text-slate-400">
            <SmallSpinner />
          </span>
        )}
        {(state === "success" || state === "empty") && (
          <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
            {isSubOpen ? "▲" : "▼"}
          </span>
        )}
      </button>

      {isSubOpen && (
        <>
          {state === "loading" && (
            <div className="flex items-center gap-2 py-2">
              <SmallSpinner />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Loading Reactome pathways…
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="space-y-1.5 py-1">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {isRateLimit
                  ? "⚠️ Reactome rate limit hit — pathway data temporarily unavailable. Try again in a few seconds."
                  : `⚠️ ${errorMessage ?? "Failed to load pathway memberships."}`}
              </p>
              <button
                onClick={onRetry}
                className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full hover:bg-amber-200 font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {state === "empty" && (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
              No Reactome pathway memberships found for {gene.officialSymbol}.
            </p>
          )}

          {state === "success" && (
            <div className="rounded-lg border border-slate-100 dark:border-slate-700/60 overflow-hidden">
              {/* Source header */}
              <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/40 flex items-center gap-2">
                <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">
                  🔬 Reactome
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
                  {totalCount}
                </span>
                <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                  curated pathways
                </span>
              </div>

              {/* Pathway rows */}
              <div className="divide-y divide-slate-50 dark:divide-slate-700/30">
                {visible.map((pw) => (
                  <PathwayRow key={pw.pathwayId} pathway={pw} />
                ))}
              </div>

              {/* Pagination */}
              {hasMore && (
                <div className="px-3 py-2 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/20">
                  <button
                    onClick={onShowMore}
                    className="text-xs font-medium px-3 py-1 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 hover:opacity-80 transition-opacity"
                  >
                    Show {Math.min(PATHWAY_PAGE_SIZE, totalCount - visibleCount)}{" "}
                    more
                  </button>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {visibleCount} of {totalCount}
                  </span>
                </div>
              )}

              <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic border-t border-slate-50 dark:border-slate-700/30">
                Source: Reactome — curated human and model organism pathways.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Individual pathway row ───────────────────────────────────────────────────

function PathwayRow({ pathway }: { pathway: PathwayMembership }) {
  return (
    <div className="px-3 py-2 flex items-start gap-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
      {/* Pathway ID — canonical identifier, monospace, smaller */}
      <span className="shrink-0 text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5 select-all whitespace-nowrap">
        {pathway.pathwayId}
      </span>

      {/* Pathway name — linked to sourceUrl */}
      <a
        href={pathway.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-xs text-slate-700 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 hover:underline leading-relaxed transition-colors"
        title={`View ${pathway.pathwayName} in Reactome PathwayBrowser`}
      >
        {pathway.pathwayName}
      </a>

      {/* Disease flag (optional) */}
      {pathway.inDisease && (
        <span
          className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
          title="Disease pathway"
        >
          disease
        </span>
      )}
    </div>
  );
}

// ─── GO Aspect section ────────────────────────────────────────────────────────

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

      {isOpen && (
        <div className="divide-y divide-slate-50 dark:divide-slate-700/30">
          {total === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
              No {config.label.toLowerCase()} annotations in NCBI Gene for this
              gene.
            </p>
          ) : (
            <>
              {visible.map((ann, idx) => (
                <AnnotationRow
                  key={`${ann.goId}-${ann.evidenceCode}-${idx}`}
                  annotation={ann}
                />
              ))}
              {hasMore && (
                <div className="px-3 py-2 flex items-center justify-between">
                  <button
                    onClick={onShowMore}
                    className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${config.badgeClass} hover:opacity-80`}
                  >
                    Show {Math.min(GO_ASPECT_PAGE_SIZE, total - visibleCount)}{" "}
                    more
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

// ─── Individual GO annotation row ─────────────────────────────────────────────

function AnnotationRow({ annotation }: { annotation: FunctionalAnnotation }) {
  const isComputational = isComputationalEvidence(annotation.evidenceCode);

  return (
    <div className="px-3 py-2 flex items-start gap-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
      <span className="shrink-0 text-xs font-mono text-slate-400 dark:text-slate-500 mt-0.5 select-all">
        {annotation.goId}
      </span>
      <span
        className={`flex-1 text-xs leading-relaxed ${
          isComputational
            ? "text-slate-400 dark:text-slate-500 italic"
            : "text-slate-700 dark:text-slate-200"
        }`}
      >
        {annotation.term}
      </span>
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
