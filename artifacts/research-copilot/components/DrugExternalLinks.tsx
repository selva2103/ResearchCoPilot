"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DrugCandidate } from "@/types/drug-target";
import type { PubChemResult } from "@/types/drug-structure";
import { drugExternalLinks, pubchemSdf3dUrl } from "@/lib/drug-target/links";

/**
 * Phase 5.10C - outbound links for one drug row. ChEMBL, DrugBank and Probes&Drugs links are
 * built from this drug's own identifiers. For small molecules, a lazy PubChem lookup runs only
 * after the button is pressed and shows a 3D SDF link only if PubChem has one.
 */

const LINK_CLASS = "text-indigo-700 dark:text-indigo-400 hover:underline";

export default function DrugExternalLinks({ candidate }: { candidate: DrugCandidate }) {
  const { chemblId } = candidate;
  const links = drugExternalLinks({
    chemblId,
    drugbankIds: candidate.drugbankIds,
    probesDrugsIds: candidate.probesDrugsIds,
  });
  const isSmallMolecule = candidate.drugType === "Small molecule";

  const [requested, setRequested] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<PubChemResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requested) return;
    const key = `${chemblId}|${retry}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    setState("loading");
    setErrorMsg(null);
    fetch("/api/drug-target/pubchem", {
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
        setResult(json as PubChemResult);
        setState("done");
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : "Request failed.");
        setState("error");
      });
  }, [requested, chemblId, retry]);

  const retryButton = (
    <button type="button" onClick={() => setRetry((n) => n + 1)} className={LINK_CLASS}>
      Retry
    </button>
  );

  let structure: ReactNode = null;
  if (isSmallMolecule) {
    if (!requested) {
      structure = (
        <button type="button" onClick={() => setRequested(true)} className={LINK_CLASS}>
          3D structure (PubChem)
        </button>
      );
    } else if (state === "error") {
      structure = (
        <span className="text-amber-600 dark:text-amber-400">
          Could not look up PubChem: {errorMsg ?? "unknown error"} {retryButton}
        </span>
      );
    } else if (state !== "done" || !result) {
      structure = <span className="text-slate-400 italic">Looking up PubChem...</span>;
    } else if (result.availability === "source-failure") {
      structure = (
        <span className="text-amber-600 dark:text-amber-400">
          PubChem or ChEMBL is temporarily unavailable. {retryButton}
        </span>
      );
    } else if (result.availability === "available") {
      const url = pubchemSdf3dUrl(result.cid);
      structure = url ? (
        <span>
          <a href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            Download 3D SDF (PubChem CID {result.cid})
          </a>{" "}
          <span className="text-[10px] text-slate-400 dark:text-slate-500">computed conformer, not experimental</span>
        </span>
      ) : (
        <span className="text-slate-500 dark:text-slate-400">No PubChem 3D structure found for this drug.</span>
      );
    } else if (result.availability === "ambiguous") {
      structure = (
        <span className="text-slate-500 dark:text-slate-400">
          {result.cidCount} PubChem records match this structure, so no 3D link is shown.
        </span>
      );
    } else if (result.availability === "no-3d") {
      structure = (
        <span className="text-slate-500 dark:text-slate-400">
          PubChem has a record (CID {result.cid}) but no computed 3D conformer.
        </span>
      );
    } else {
      structure = <span className="text-slate-500 dark:text-slate-400">No PubChem record found for this drug.</span>;
    }
  }

  if (links.length === 0 && !structure) return null;
  return (
    <div className="mt-0.5 ml-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className="text-slate-400 dark:text-slate-500">Links:</span>
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {l.label}
        </a>
      ))}
      {structure}
    </div>
  );
}
