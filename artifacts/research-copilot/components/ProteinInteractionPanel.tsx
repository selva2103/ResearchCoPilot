"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  InteractionResolutionResult,
  ProteinInteractionPartner,
} from "@/types/protein-interaction";

/**
 * Phase 5.9A - Protein Interactions (STRING). Lazy: nothing is fetched until the
 * panel is expanded. Self-contained so it can be mounted next to the Structure panel.
 */

const SCORE_OPTIONS = [400, 700, 900] as const;

function ChannelChip({ label, value }: { label: string; value: number | null }) {
  if (value === null || value <= 0) return null;
  return (
    <span
      title={`${label} evidence score from STRING (0-1)`}
      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300"
    >
      {label} {value.toFixed(2)}
    </span>
  );
}

function PartnerRow({ p }: { p: ProteinInteractionPartner }) {
  const router = useRouter();
  const isHuman = p.ncbiTaxonId === 9606;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 border-b border-slate-100 dark:border-slate-700/40 last:border-b-0">
      {isHuman ? (
        <button
          type="button"
          onClick={() => router.push(`/results?q=${encodeURIComponent(p.partnerName)}`)}
          title="Search this name (a search, not a confirmed match)"
          className="text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-400 hover:underline"
        >
          {p.partnerName}
        </button>
      ) : (
        <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">{p.partnerName}</span>
      )}
      <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{p.partnerStringId}</span>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">score {p.combinedScore.toFixed(3)}</span>
      <div className="ml-auto flex flex-wrap gap-1">
        <ChannelChip label="Experiments" value={p.channelScores.experiments} />
        <ChannelChip label="Databases" value={p.channelScores.databases} />
        <ChannelChip label="Text mining" value={p.channelScores.textmining} />
      </div>
    </div>
  );
}

export default function ProteinInteractionPanel({
  accession,
  geneId,
  organism,
  taxonomyId,
}: {
  accession: string;
  geneId: string;
  organism: string;
  taxonomyId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [minScore, setMinScore] = useState<number>(700);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<InteractionResolutionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const key = `${accession}|${taxonomyId}|${minScore}|${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setErrorMsg(null);
    fetch("/api/protein/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accession, geneId, organism, taxonomyId, minScore }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (keyRef.current !== key) return; // stale response
        if (!res.ok || !json || json.error) {
          setErrorMsg(typeof json?.error === "string" ? json.error : "Interaction data unavailable.");
          setState("error");
          return;
        }
        setResult(json as InteractionResolutionResult);
        setState("done");
      })
      .catch(() => {
        if (keyRef.current === key) {
          setErrorMsg("Network error — interaction data unavailable.");
          setState("error");
        }
      });
  }, [expanded, accession, geneId, organism, taxonomyId, minScore, retry]);

  const retryBtn = (
    <button
      type="button"
      onClick={() => {
        keyRef.current = null;
        setRetry((n) => n + 1);
      }}
      className="not-italic font-medium underline hover:no-underline"
    >
      Retry
    </button>
  );

  return (
    <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-indigo-200 dark:border-indigo-800/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
      >
        <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">
          🕸️ Protein Interactions
        </span>
        <span className="ml-auto text-slate-400 dark:text-slate-500 text-[11px]">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 pt-0.5 border-t border-indigo-200 dark:border-indigo-800/60 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Minimum score</span>
            {SCORE_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMinScore(s)}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  minScore === s
                    ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                    : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                }`}
              >
                {(s / 1000).toFixed(1)}
              </button>
            ))}
          </div>

          {state === "loading" && (
            <p className="text-xs text-slate-400 dark:text-slate-500">Loading interactions from STRING (a few seconds)…</p>
          )}

          {state === "error" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 italic">
              ⚠️ {errorMsg} {retryBtn}
            </p>
          )}

          {state === "done" && result && (
            <>
              {result.identifierStatus !== "resolved" && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  No UniProt entry could be confidently resolved for this protein, so no interaction lookup was attempted.
                </p>
              )}
              {result.identifierStatus === "resolved" && result.stringMappingStatus === "unresolved" && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  STRING has no matching protein for this UniProt entry in this species.
                </p>
              )}
              {result.sourceStatus === "error" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                  ⚠️ STRING is temporarily unavailable. {retryBtn}
                </p>
              )}
              {result.sourceStatus === "empty" && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  No interaction partners at combined score ≥ {(result.minScore / 1000).toFixed(1)} in STRING. A lower minimum score may show more.
                </p>
              )}
              {result.partners.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic mb-1">
                    {result.partners.length} partner{result.partners.length !== 1 ? "s" : ""} at combined score ≥{" "}
                    {(result.minScore / 1000).toFixed(1)}
                    {result.partners.length >= result.limit ? ` (first ${result.limit} shown; more may exist)` : ""}.
                  </p>
                  {result.partners.map((p) => (
                    <PartnerRow key={p.partnerStringId} p={p} />
                  ))}
                </div>
              )}
              {result.availability !== "source-failure" && result.identifierStatus === "resolved" && result.stringMappingStatus === "resolved" && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                  Data: STRING{result.stringVersion ? ` v${result.stringVersion}` : ""}. Edges are functional associations and are not
                  necessarily physical binding. Only human partners are clickable (a search, not a confirmed match).
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
