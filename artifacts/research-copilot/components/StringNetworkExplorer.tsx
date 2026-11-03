"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InteractionAnalysisResult } from "@/types/protein-interaction-analysis";

/**
 * Phase 5.9B - STRING network view and analysis for one protein.
 * Lazy: nothing is fetched until the section is opened. The interactive embed is
 * loaded only on click. Links and the static SVG work without the embed script.
 */

const STRING_BASE = "https://string-db.org";
const EMBED_SRC = STRING_BASE + "/javascript/combined_embedded_network_v2.0.6.js";
const CALLER = "ResearchCoPilot";
const MAX_NETWORK_IDS = 11; // query protein + top 10 partners (analysis route allows 12)

type Flavor = "evidence" | "confidence" | "actions";
const FLAVORS: { id: Flavor; label: string; hint: string }[] = [
  { id: "evidence", label: "Evidence", hint: "Line colour shows the type of evidence" },
  { id: "confidence", label: "Confidence", hint: "Line thickness shows interaction confidence" },
  { id: "actions", label: "Actions", hint: "Shows the type of action between proteins" },
];

type GetString = (base: string, opts: Record<string, unknown>) => void;
function getEmbedFn(): GetString | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { getSTRING?: unknown }).getSTRING;
  return typeof fn === "function" ? (fn as GetString) : null;
}

let scriptPromise: Promise<void> | null = null;
function loadEmbedScript(): Promise<void> {
  if (getEmbedFn()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = EMBED_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      el.remove();
      reject(new Error("The STRING embed script could not be loaded."));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

// STRING's embed supports a single #stringEmbedded element per page.
let activeOwner: { id: symbol; close: () => void } | null = null;

function qs(ids: string[], taxon: string, minScore: number, flavor: Flavor): string {
  const p = new URLSearchParams();
  p.set("identifiers", ids.join("\r"));
  p.set("species", taxon);
  p.set("required_score", String(minScore));
  p.set("network_flavor", flavor);
  p.set("caller_identity", CALLER);
  return p.toString();
}

function fmtP(x: number): string {
  if (x === 0) return "0";
  return x < 0.001 ? x.toExponential(1) : x.toFixed(4);
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700/60 px-2 py-1">
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}

const linkCls = "text-[11px] text-indigo-700 dark:text-indigo-400 underline hover:no-underline";
const btnCls =
  "text-[10px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40";

export default function StringNetworkExplorer({
  queryStringId,
  partnerStringIds,
  taxonomyId,
  minScore,
}: {
  queryStringId: string;
  partnerStringIds: string[];
  taxonomyId: string;
  minScore: number;
}) {
  const [open, setOpen] = useState(false);
  const [flavor, setFlavor] = useState<Flavor>("evidence");
  const [interactive, setInteractive] = useState(false);
  const [embedState, setEmbedState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [anaState, setAnaState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysis, setAnalysis] = useState<InteractionAnalysisResult | null>(null);
  const [anaError, setAnaError] = useState<string | null>(null);
  const [anaRetry, setAnaRetry] = useState(0);
  const anaKeyRef = useRef<string | null>(null);
  const embedRef = useRef<HTMLDivElement | null>(null);
  const ownerRef = useRef<symbol>(Symbol("string-embed"));

  const partnerKey = partnerStringIds.join("|");
  const ids = useMemo(() => {
    const prefix = taxonomyId + ".";
    const all = [queryStringId, ...partnerKey.split("|")].filter((x) => x && x.startsWith(prefix));
    return Array.from(new Set(all)).slice(0, MAX_NETWORK_IDS);
  }, [queryStringId, partnerKey, taxonomyId]);
  const idsKey = ids.join("|");
  const hasNetwork = ids.length >= 2;

  const query = qs(ids.length > 0 ? ids : [queryStringId], taxonomyId, minScore, flavor);
  const openUrl = STRING_BASE + "/cgi/network?" + query;
  const svgUrl = STRING_BASE + "/api/svg/network?" + query;
  const pngUrl = STRING_BASE + "/api/highres_image/network?" + query;
  const tsvUrl = STRING_BASE + "/api/tsv/network?" + query;

  useEffect(() => {
    setImgFailed(false);
  }, [svgUrl]);

  // Interactive embed (official STRING script), re-initialised when the network or style changes.
  useEffect(() => {
    if (!open || !interactive || !hasNetwork) return;
    const node = embedRef.current;
    let cancelled = false;
    setEmbedState("loading");
    setEmbedError(null);
    if (activeOwner && activeOwner.id !== ownerRef.current) activeOwner.close();
    activeOwner = { id: ownerRef.current, close: () => setInteractive(false) };
    const timer = window.setTimeout(() => {
      loadEmbedScript()
        .then(() => {
          if (cancelled) return;
          const fn = getEmbedFn();
          if (!node || !fn) throw new Error("The STRING embed is not available in this page.");
          node.innerHTML = "";
          fn(STRING_BASE, {
            species: taxonomyId,
            identifiers: ids,
            network_flavor: flavor,
            required_score: minScore,
            caller_identity: CALLER,
          });
          setEmbedState("ready");
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setEmbedState("error");
          setEmbedError(e instanceof Error ? e.message : "The interactive network could not be started.");
        });
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (node) node.innerHTML = "";
      if (activeOwner && activeOwner.id === ownerRef.current) activeOwner = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interactive, hasNetwork, idsKey, flavor, taxonomyId, minScore]);

  // Network statistics and GO enrichment (committed analysis route), loaded when the section opens.
  useEffect(() => {
    if (!open || !hasNetwork) return;
    const key = idsKey + "|" + taxonomyId + "|" + minScore + "|" + anaRetry;
    if (anaKeyRef.current === key) return;
    anaKeyRef.current = key;
    setAnaState("loading");
    setAnaError(null);
    fetch("/api/protein/interaction-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stringIds: ids, taxonomyId, minScore }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (anaKeyRef.current !== key) return;
        if (!res.ok || !json || json.error) {
          setAnaError(typeof json?.error === "string" ? json.error : "Network analysis unavailable.");
          setAnaState("error");
          return;
        }
        setAnalysis(json as InteractionAnalysisResult);
        setAnaState("done");
      })
      .catch(() => {
        if (anaKeyRef.current === key) {
          setAnaError("Network error - analysis unavailable.");
          setAnaState("error");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasNetwork, idsKey, taxonomyId, minScore, anaRetry]);

  const retryAna = (
    <button
      type="button"
      onClick={() => {
        anaKeyRef.current = null;
        setAnaRetry((n) => n + 1);
      }}
      className="not-italic font-medium underline hover:no-underline"
    >
      Retry
    </button>
  );

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800/40"
      >
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Network view and analysis
        </span>
        <span className="ml-auto text-slate-400 dark:text-slate-500 text-[11px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-2 pb-2 pt-1 border-t border-slate-200 dark:border-slate-700/60 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Edge style</span>
            {FLAVORS.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.hint}
                onClick={() => setFlavor(f.id)}
                className={
                  "text-[10px] px-1.5 py-0.5 rounded border " +
                  (flavor === f.id
                    ? "border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
                    : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40")
                }
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={openUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Open in STRING ↗
            </a>
            {hasNetwork && (
              <>
                <a href={svgUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  Export SVG
                </a>
                <a href={pngUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  Export PNG
                </a>
                <a href={tsvUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  Export TSV
                </a>
              </>
            )}
          </div>

          {!hasNetwork && (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic">
              No partners at this minimum score, so there is no network to draw here. The STRING link above shows what
              STRING itself displays for this protein.
            </p>
          )}

          {hasNetwork && (
            <>
              <div className="rounded bg-white p-1 overflow-x-auto">
                {imgFailed ? (
                  <p className="text-xs text-amber-600 italic p-2">
                    ⚠️ The network image could not be loaded from STRING. Use the links above.
                  </p>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={svgUrl}
                    alt={"STRING network of " + ids.length + " proteins"}
                    loading="lazy"
                    onError={() => setImgFailed(true)}
                    className="max-w-full h-auto"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                {!interactive ? (
                  <button type="button" onClick={() => setInteractive(true)} className={btnCls}>
                    Load interactive network (STRING embed)
                  </button>
                ) : (
                  <button type="button" onClick={() => setInteractive(false)} className={btnCls}>
                    Close interactive network
                  </button>
                )}
                {interactive && embedState === "loading" && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">Loading the STRING interactive network…</p>
                )}
                {interactive && embedState === "error" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                    ⚠️ {embedError} The static image and links above still work.
                  </p>
                )}
                {interactive && (
                  <div className="rounded bg-white p-1 overflow-x-auto">
                    <div id="stringEmbedded" ref={embedRef} />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Network analysis</p>
                {anaState === "loading" && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">Computing statistics and enrichment (a few seconds)…</p>
                )}
                {anaState === "error" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                    ⚠️ {anaError} {retryAna}
                  </p>
                )}
                {anaState === "done" && analysis && (
                  <>
                    {analysis.sourceStatus === "error" && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                        ⚠️ STRING analysis is temporarily unavailable. {retryAna}
                      </p>
                    )}
                    {analysis.stats && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        <StatCell label="Nodes" value={String(analysis.stats.numberOfNodes)} />
                        <StatCell label="Edges" value={String(analysis.stats.numberOfEdges)} />
                        <StatCell label="Avg. node degree" value={analysis.stats.averageNodeDegree.toFixed(2)} />
                        <StatCell label="Avg. local clustering" value={analysis.stats.localClusteringCoefficient.toFixed(3)} />
                        <StatCell label="Expected edges" value={String(analysis.stats.expectedNumberOfEdges)} />
                        <StatCell label="PPI enrichment p-value" value={fmtP(analysis.stats.pValue)} />
                      </div>
                    )}
                    {analysis.sourceStatus !== "error" && analysis.statsStatus === "error" && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                        ⚠️ Network statistics are unavailable. {retryAna}
                      </p>
                    )}
                    {analysis.enrichmentStatus === "success" && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] text-left">
                          <thead>
                            <tr className="text-slate-500 dark:text-slate-400">
                              <th className="pr-2 py-0.5 font-medium">GO Biological Process</th>
                              <th className="pr-2 py-0.5 font-medium">In network</th>
                              <th className="pr-2 py-0.5 font-medium">In background</th>
                              <th className="pr-2 py-0.5 font-medium">Strength</th>
                              <th className="py-0.5 font-medium">FDR</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-700 dark:text-slate-200">
                            {analysis.goProcess.map((t) => (
                              <tr key={t.term} className="border-t border-slate-100 dark:border-slate-700/40">
                                <td className="pr-2 py-0.5">
                                  {t.description} <span className="font-mono text-[10px] text-slate-400">{t.term}</span>
                                </td>
                                <td className="pr-2 py-0.5">{t.genesInNetwork}</td>
                                <td className="pr-2 py-0.5">{t.genesInBackground}</td>
                                <td className="pr-2 py-0.5">{t.strength === null ? "-" : t.strength.toFixed(2)}</td>
                                <td className="py-0.5">{fmtP(t.fdr)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {analysis.enrichmentStatus === "empty" && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                        No GO Biological Process terms are enriched in this network at FDR ≤ 0.05.
                      </p>
                    )}
                    {analysis.sourceStatus !== "error" && analysis.enrichmentStatus === "error" && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 italic">
                        ⚠️ GO enrichment is unavailable. {retryAna}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                      Network = the query protein plus its top {ids.length - 1} partners at combined score ≥{" "}
                      {(minScore / 1000).toFixed(1)}. Those partners were chosen because they connect to the query protein,
                      so these statistics and the enrichment describe this neighbourhood, not the protein alone. Data: STRING
                      {analysis.stringVersion ? " v" + analysis.stringVersion : ""}.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
