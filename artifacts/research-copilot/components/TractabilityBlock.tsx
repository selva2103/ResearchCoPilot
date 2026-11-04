"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TractabilityEntry, TractabilityResult } from "@/types/drug-target-extras";

/**
 * Phase 5.10B - Tractability (Open Targets). Shows only the positive in silico assessments,
 * grouped by modality. It is not evidence that a drug will work. Mounted inside the expanded
 * Drug Target panel, so it loads lazily.
 */

const MODALITY_ORDER = ["SM", "AB", "PR", "OC"];
const MODALITY_NAMES: Record<string, string> = {
  SM: "Small molecule",
  AB: "Antibody",
  PR: "PROTAC",
  OC: "Other clinical modalities",
};

type Response = TractabilityResult & { cached?: boolean };

export default function TractabilityBlock({
  ensemblId,
  geneId,
  taxonomyId,
}: {
  ensemblId: string;
  geneId: string;
  taxonomyId: string;
}) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [result, setResult] = useState<Response | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${ensemblId}|${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setErrorMsg(null);
    fetch("/api/drug-target/tractability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ensemblId, geneId, taxonomyId }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) {
          throw new Error(
            json && typeof json.error === "string" ? json.error : `Request failed (HTTP ${res.status}).`
          );
        }
        setResult(json as Response);
        setState("done");
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : "Request failed.");
        setState("error");
      });
  }, [ensemblId, geneId, taxonomyId, retry]);

  const retryButton = (
    <button
      type="button"
      onClick={() => setRetry((n) => n + 1)}
      className="text-[11px] text-indigo-700 dark:text-indigo-400 hover:underline"
    >
      Retry
    </button>
  );

  let body: ReactNode;
  if (state === "loading") {
    body = <p className="text-xs text-slate-400 italic">Loading tractability...</p>;
  } else if (state === "error" || !result) {
    body = (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Could not load tractability: {errorMsg ?? "unknown error"} {retryButton}
      </p>
    );
  } else if (result.availability === "source-failure") {
    body = (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Tractability is temporarily unavailable from Open Targets. {retryButton}
      </p>
    );
  } else if (result.availability === "unresolved") {
    body = <p className="text-xs text-slate-500 dark:text-slate-400">Open Targets does not recognise this Ensembl gene ID.</p>;
  } else if (result.availability === "none" || result.availability === "not-applicable") {
    body = <p className="text-xs text-slate-500 dark:text-slate-400">No tractability assessments are listed for this gene.</p>;
  } else {
    const byModality = new Map<string, TractabilityEntry[]>();
    for (const p of result.positives) {
      const list = byModality.get(p.modality) ?? [];
      list.push(p);
      byModality.set(p.modality, list);
    }
    const extra = Array.from(byModality.keys()).filter((m) => !MODALITY_ORDER.includes(m));
    const order = [...MODALITY_ORDER, ...extra];
    body = (
      <div className="space-y-0.5">
        {order.map((m) => {
          const items = byModality.get(m) ?? [];
          const name = MODALITY_NAMES[m] ?? m;
          return (
            <p key={m} className="text-[11px] text-slate-600 dark:text-slate-300">
              <span className="font-medium">{name}:</span>{" "}
              {items.length > 0 ? (
                items.map((i) => i.label).join(", ")
              ) : (
                <span className="text-slate-400 dark:text-slate-500">no positive assessments</span>
              )}
            </p>
          );
        })}
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {result.positives.length} of {result.assessedCount} assessments positive. These are in silico assessments
          by Open Targets, not evidence that a drug will work.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700/40">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Tractability (Open Targets)</p>
      {body}
    </div>
  );
}
