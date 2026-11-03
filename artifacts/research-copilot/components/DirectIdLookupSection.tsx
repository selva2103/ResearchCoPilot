"use client";

import { useEffect, useRef, useState } from "react";

const UNIPROT_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;
const PDB_RE = /^[1-9][A-Z0-9]{3}$/;

interface UniProtFound {
  kind: "uniprot";
  status: "found";
  accession: string;
  entryName: string | null;
  reviewed: boolean | null;
  name: string | null;
  gene: string | null;
  organism: string | null;
  taxId: number | null;
  length: number | null;
  functionText: string | null;
  links: { entry: string; fasta: string };
}

interface PdbFound {
  kind: "pdb";
  status: "found";
  id: string;
  title: string | null;
  method: string | null;
  resolution: number | null;
  releaseDate: string | null;
  links: { entry: string; view3d: string; cif: string; pdb: string };
}

type Found = UniProtFound | PdbFound;

const chip =
  "text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200";
const linkCls =
  "text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30";

/**
 * Direct lookup by identifier. Renders only when the query is exactly shaped like a
 * UniProt accession or a PDB ID AND the source confirms the entry exists. Unknown IDs
 * (including gene symbols that merely look like accessions, e.g. P2RY12) render nothing.
 */
export default function DirectIdLookupSection({ originalQuery }: { originalQuery: string }) {
  const id = originalQuery.trim().toUpperCase();
  const isId = UNIPROT_RE.test(id) || PDB_RE.test(id);
  const [state, setState] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [data, setData] = useState<Found | null>(null);
  const [retry, setRetry] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isId) {
      keyRef.current = null;
      setState("idle");
      setData(null);
      return;
    }
    const key = `${id}#${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setData(null);
    fetch("/api/protein/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (keyRef.current !== key) return; // stale response
        if (!res.ok || !json || json.error) {
          setState("error");
          return;
        }
        if (json.status === "found") {
          setData(json as Found);
          setState("found");
        } else {
          setState("idle"); // valid shape, unknown ID: show nothing
        }
      })
      .catch(() => {
        if (keyRef.current === key) setState("error");
      });
  }, [id, isId, retry]);

  if (!isId || state === "idle" || state === "loading") return null;

  if (state === "error") {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-white/80 dark:bg-slate-800/60 px-5 py-4 text-sm text-amber-600 dark:text-amber-400">
        Direct lookup of {id} is unavailable.{" "}
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="font-medium underline hover:no-underline">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (data.kind === "uniprot") {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/60 overflow-hidden shadow-sm backdrop-blur-sm">
        <div className="bg-indigo-600 px-5 py-4 flex items-center gap-2">
          <span className="text-xl">🧬</span>
          <h3 className="font-semibold text-white text-base">UniProt entry</h3>
          {data.reviewed !== null && (
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
              {data.reviewed ? "Reviewed (Swiss-Prot)" : "Unreviewed (TrEMBL)"}
            </span>
          )}
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{data.name ?? data.accession}</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className={chip}>{data.accession}</span>
            {data.entryName && <span className={chip}>{data.entryName}</span>}
            {data.gene && <span className={chip}>{data.gene}</span>}
            {data.organism && (
              <span className="text-xs text-slate-500 dark:text-slate-400 italic">{data.organism}</span>
            )}
            {data.length !== null && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{data.length} aa</span>
            )}
          </div>
          {data.functionText && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Function (UniProt annotation)</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{data.functionText}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={data.links.entry} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Open in UniProt
            </a>
            <a href={data.links.fasta} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Sequence (FASTA)
            </a>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
            Direct lookup by accession. Data: UniProt.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/60 overflow-hidden shadow-sm backdrop-blur-sm">
      <div className="bg-violet-600 px-5 py-4 flex items-center gap-2">
        <span className="text-xl">🧊</span>
        <h3 className="font-semibold text-white text-base">PDB entry</h3>
        {data.method && (
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
            {data.method}
          </span>
        )}
      </div>
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{data.title ?? data.id}</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className={chip}>{data.id}</span>
          {data.resolution !== null && (
            <span className="text-xs text-slate-500 dark:text-slate-400">{data.resolution} Å</span>
          )}
          {data.releaseDate && (
            <span className="text-xs text-slate-500 dark:text-slate-400">released {data.releaseDate.slice(0, 10)}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={data.links.entry} target="_blank" rel="noopener noreferrer" className={linkCls}>
            Open in RCSB PDB
          </a>
          <a href={data.links.view3d} target="_blank" rel="noopener noreferrer" className={linkCls}>
            RCSB 3D view
          </a>
          <a href={data.links.cif} className={linkCls}>
            Download mmCIF
          </a>
          <a href={data.links.pdb} className={linkCls}>
            Download PDB
          </a>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          Direct lookup by PDB ID. Data: RCSB PDB.
        </p>
      </div>
    </div>
  );
}
