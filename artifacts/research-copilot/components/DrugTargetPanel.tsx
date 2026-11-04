"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GeneRecord } from "@/types/gene-record";
import type { DrugCandidate, DrugTargetResult } from "@/types/drug-target";
import { stageLabel } from "@/lib/drug-target/stages";
import DrugIndications from "@/components/DrugIndications";
import TractabilityBlock from "@/components/TractabilityBlock";
import DrugExternalLinks from "@/components/DrugExternalLinks";
import { geneExternalLinks } from "@/lib/drug-target/links";

/**
 * Phase 5.10A - Drugs and clinical candidates (Open Targets). Gene-level, human only.
 * Lazy: nothing is fetched until the panel is expanded. Stages are shown exactly as
 * returned; this panel makes no efficacy or recommendation claims.
 */

const INITIAL_ROWS = 15;
const CITATION_URL = "https://platform-docs.opentargets.org/citation";

type PanelResponse = DrugTargetResult & { cached?: boolean; executionTimeMs?: number };

function CandidateRow({ c }: { c: DrugCandidate }) {
  const drugStageDiffers = c.drugStage !== null && c.drugStage !== c.rowStage;
  const shown = c.mechanisms.slice(0, 2);
  const more = c.mechanisms.length - shown.length;
  return (
    <div className="py-1.5 border-b border-slate-100 dark:border-slate-700/40 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{c.chemblId}</span>
        {c.drugType && <span className="text-[10px] text-slate-500 dark:text-slate-400">{c.drugType}</span>}
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Stage: {stageLabel(c.rowStage)}
        </span>
        {drugStageDiffers && (
          <span
            className="text-[10px] text-slate-500 dark:text-slate-400"
            title="The drug's overall stage in Open Targets differs from the stage on this row."
          >
            Drug overall: {stageLabel(c.drugStage)}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="mt-0.5 ml-3 list-disc text-[11px] text-slate-500 dark:text-slate-400">
          {shown.map((m, i) => (
            <li key={`${c.chemblId}-m${i}`}>
              {m.mechanismOfAction}
              {m.targetName ? ` (${m.targetName})` : ""}
            </li>
          ))}
          {more > 0 && <li>+{more} more mechanisms</li>}
        </ul>
      )}
      <DrugExternalLinks candidate={c} />
      <DrugIndications chemblId={c.chemblId} />
    </div>
  );
}

export default function DrugTargetPanel({ gene }: { gene: GeneRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<PanelResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const keyRef = useRef<string | null>(null);

  const isHuman = String(gene.taxonomyId) === "9606";
  const ensemblId = gene.ensemblId;

  useEffect(() => {
    if (!expanded || !isHuman || !ensemblId) return;
    const key = `${ensemblId}|${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setErrorMsg(null);
    setShowAll(false);
    fetch("/api/drug-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ensemblId,
        geneId: gene.geneId,
        organism: gene.organism,
        taxonomyId: gene.taxonomyId,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          throw new Error(
            json && typeof json.error === "string" ? json.error : `Request failed (HTTP ${res.status}).`
          );
        }
        setResult(json as PanelResponse);
        setState("done");
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : "Request failed.");
        setState("error");
      });
  }, [expanded, isHuman, ensemblId, retry, gene.geneId, gene.organism, gene.taxonomyId]);

  const retryButton = (
    <button
      type="button"
      onClick={() => setRetry((n) => n + 1)}
      className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
    >
      Retry
    </button>
  );

  let content: ReactNode;
  if (!isHuman) {
    content = (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Drug target data is shown for human genes in this phase.
      </p>
    );
  } else if (!ensemblId) {
    content = (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Drug target data is unavailable: no Ensembl gene ID was found for this gene.
      </p>
    );
  } else if (state === "loading" || state === "idle" || (result !== null && result.ensemblId !== ensemblId)) {
    content = <p className="text-xs text-slate-400 italic">Loading from Open Targets...</p>;
  } else if (state === "error" || !result) {
    content = (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Could not load drug target data: {errorMsg ?? "unknown error"} {retryButton}
      </p>
    );
  } else if (result.availability === "source-failure") {
    content = (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Open Targets is temporarily unavailable. {retryButton}
      </p>
    );
  } else if (result.availability === "unresolved") {
    content = (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Open Targets does not recognise this Ensembl gene ID.
      </p>
    );
  } else if (result.availability === "none") {
    content = (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        No drugs or clinical candidates are listed in Open Targets for this gene.
      </p>
    );
  } else if (result.availability === "not-applicable") {
    content = (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Drug target data is shown for human genes in this phase.
      </p>
    );
  } else {
    const rows = showAll ? result.candidates : result.candidates.slice(0, INITIAL_ROWS);
    content = (
      <div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
          {result.totalCount} drugs and clinical candidates listed
          {result.approvedSymbol ? ` for ${result.approvedSymbol}` : ""}. Stage is shown as returned by Open
          Targets; mechanisms belong to the drug and can involve other targets.
        </p>
        {rows.map((c, i) => (
          <CandidateRow key={`${c.chemblId}-${i}`} c={c} />
        ))}
        {!showAll && result.candidates.length > INITIAL_ROWS && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
          >
            Show all {result.candidates.length}
          </button>
        )}
      </div>
    );
  }

  const resultMatches = result !== null && result.ensemblId === ensemblId;
  const geneLinks =
    isHuman && ensemblId
      ? geneExternalLinks({
          ensemblId,
          symbol: (resultMatches ? result?.approvedSymbol : null) ?? gene.officialSymbol,
          uniprotId: resultMatches ? (result?.uniprotId ?? null) : null,
        })
      : [];

  const showFooter =
    state === "done" && result !== null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Drugs and clinical candidates (Open Targets)
        </span>
        <span className="text-[10px] text-slate-400">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {geneLinks.length > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Gene links:{" "}
              {geneLinks.map((l, i) => (
                <span key={l.href}>
                  {i > 0 ? " | " : ""}
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-700 dark:text-indigo-400 hover:underline"
                  >
                    {l.label}
                  </a>
                </span>
              ))}
            </p>
          )}
          {content}
          {isHuman && ensemblId && (
            <TractabilityBlock ensemblId={ensemblId} geneId={gene.geneId} taxonomyId={String(gene.taxonomyId)} />
          )}
          {showFooter && result && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Data: Open Targets Platform{result.dataVersion ? ` ${result.dataVersion}` : ""} (CC0 1.0). Drug
              records originate from ChEMBL (CC BY-SA 3.0, per Open Targets). Tractability assessments are computed by Open Targets.{" "}
              <a
                href={CITATION_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-slate-600 dark:hover:text-slate-300"
              >
                How to cite
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
