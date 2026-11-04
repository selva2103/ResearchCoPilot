"use client";

import { useEffect, useRef, useState } from "react";
import type { DrugIndicationsResult } from "@/types/drug-target-extras";
import { stageLabel } from "@/lib/drug-target/stages";

/**
 * Phase 5.10B - lazy per-drug indications (Open Targets). Nothing is fetched until the
 * button is pressed. Indications belong to the drug overall, not only to the queried gene.
 */

const INITIAL_ROWS = 10;

export default function DrugIndications({ chemblId }: { chemblId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<DrugIndicationsResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = `${chemblId}|${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setErrorMsg(null);
    fetch("/api/drug-target/drug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chemblId }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          throw new Error(
            json && typeof json.error === "string" ? json.error : `Request failed (HTTP ${res.status}).`
          );
        }
        setResult(json as DrugIndicationsResult);
        setState("done");
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : "Request failed.");
        setState("error");
      });
  }, [open, chemblId, retry]);

  const retryButton = (
    <button
      type="button"
      onClick={() => setRetry((n) => n + 1)}
      className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
    >
      Retry
    </button>
  );

  return (
    <div className="mt-0.5 ml-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
      >
        {open ? "Hide indications" : "Show indications"}
      </button>
      {open && (
        <div className="mt-0.5">
          {(state === "loading" || state === "idle") && (
            <p className="text-[11px] text-slate-400 italic">Loading indications...</p>
          )}
          {state === "error" && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Could not load indications: {errorMsg ?? "unknown error"} {retryButton}
            </p>
          )}
          {state === "done" && result && result.availability === "source-failure" && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Open Targets is temporarily unavailable. {retryButton}
            </p>
          )}
          {state === "done" && result && result.availability === "unresolved" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Open Targets does not recognise this drug ID.</p>
          )}
          {state === "done" && result && result.availability === "none" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">No indications are listed for this drug.</p>
          )}
          {state === "done" && result && result.availability === "available" && (
            <div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {result.totalCount} indications listed for this drug overall (not only for this gene). Stage is shown as
                returned.
              </p>
              <ul className="list-disc ml-3 text-[11px] text-slate-600 dark:text-slate-300">
                {(showAll ? result.indications : result.indications.slice(0, INITIAL_ROWS)).map((i, idx) => (
                  <li key={`${chemblId}-i${idx}`}>
                    {i.diseaseName} <span className="text-slate-400 dark:text-slate-500">({stageLabel(i.stage)})</span>
                  </li>
                ))}
              </ul>
              {!showAll && result.indications.length > INITIAL_ROWS && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
                >
                  Show all {result.indications.length}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
