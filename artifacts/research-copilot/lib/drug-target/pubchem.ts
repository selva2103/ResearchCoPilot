/**
 * lib/drug-target/pubchem.ts - Phase 5.10C
 *
 * For one small-molecule drug: ChEMBL molecule record -> standard InChIKey -> PubChem CID
 * (accepted only when exactly one CID matches) -> check that PubChem has a computed 3D SDF
 * with non-zero z-coordinates. The 3D file itself is downloaded by the browser from PubChem.
 * Failure discipline as in 5.10A/B: transport or unexpected HTTP failures return
 * "source-failure" and are NEVER cached. Every other outcome is cached.
 */

import { fetchWithRetry } from "@/lib/utils";
import { CHEMBL_ID_RE, makeCache } from "@/lib/drug-target/extras";
import type { PubChemResult } from "@/types/drug-structure";

const CHEMBL_MOLECULE_URL = "https://www.ebi.ac.uk/chembl/api/data/molecule";
const PUBCHEM_COMPOUND_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound";
const FETCH_TIMEOUT_MS = 25000;
const REQUEST_SPACING_MS = 300;
const INCHIKEY_RE = /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/;
const CID_RE = /^\d{1,12}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeLimiter(delayMs: number) {
  let chain: Promise<void> = Promise.resolve();
  return function withLimit<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.then(() => sleep(delayMs)).catch(() => sleep(delayMs));
    return next;
  };
}

const withLimit = makeLimiter(REQUEST_SPACING_MS);

// -- pure interpretation ---------------------------------------------------------

export type ChemblStep = { kind: "key"; inchiKey: string } | { kind: "none" } | { kind: "failure" };

export function interpretChemblMolecule(chemblId: string, status: number, text: string): ChemblStep {
  if (status === 404) return { kind: "none" };
  if (status !== 200) return { kind: "failure" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: "failure" };
  }
  const root = obj(body);
  if (!root || str(root.molecule_chembl_id) !== chemblId) return { kind: "failure" };
  if (root.molecule_structures === null) return { kind: "none" };
  const structures = obj(root.molecule_structures);
  const key = str(structures?.standard_inchi_key);
  if (!structures || !key || !INCHIKEY_RE.test(key)) return { kind: "failure" };
  return { kind: "key", inchiKey: key };
}

export type CidStep =
  | { kind: "one"; cid: string }
  | { kind: "many"; count: number }
  | { kind: "none" }
  | { kind: "failure" };

export function interpretPubChemCids(status: number, text: string): CidStep {
  if (status === 404) return { kind: "none" };
  if (status !== 200) return { kind: "failure" };
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0 || !tokens.every((t) => CID_RE.test(t))) return { kind: "failure" };
  if (tokens.length === 1) return { kind: "one", cid: tokens[0] };
  return { kind: "many", count: tokens.length };
}

/** True when an MDL V2000 SDF has at least one atom with a non-zero z-coordinate. */
export function hasThreeDCoordinates(sdf: string): boolean {
  const lines = sdf.split(/\r?\n/);
  if (lines.length < 5) return false;
  const atomCount = parseInt(lines[3].slice(0, 3), 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return false;
  let maxAbsZ = 0;
  for (const line of lines.slice(4, 4 + atomCount)) {
    const z = parseFloat(line.slice(20, 30));
    if (Number.isFinite(z) && Math.abs(z) > maxAbsZ) maxAbsZ = Math.abs(z);
  }
  return maxAbsZ > 1e-3;
}

export type SdfStep = { kind: "yes" } | { kind: "no" } | { kind: "failure" };

export function interpretSdf3d(status: number, text: string): SdfStep {
  if (status === 404) return { kind: "no" };
  if (status !== 200) return { kind: "failure" };
  return hasThreeDCoordinates(text) ? { kind: "yes" } : { kind: "no" };
}

// -- lookup ------------------------------------------------------------------------

function failureResult(chemblId: string): PubChemResult {
  return { chemblId, availability: "source-failure", cid: null, cidCount: 0 };
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  return withLimit(async () => {
    const res = await fetchWithRetry(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const text = await res.text();
    return { status: res.status, text };
  });
}

async function lookup(chemblId: string): Promise<PubChemResult> {
  const mol = await fetchText(`${CHEMBL_MOLECULE_URL}/${chemblId}.json`);
  const s1 = interpretChemblMolecule(chemblId, mol.status, mol.text);
  if (s1.kind === "failure") return failureResult(chemblId);
  if (s1.kind === "none") return { chemblId, availability: "no-structure", cid: null, cidCount: 0 };

  const cids = await fetchText(`${PUBCHEM_COMPOUND_URL}/inchikey/${s1.inchiKey}/cids/TXT`);
  const s2 = interpretPubChemCids(cids.status, cids.text);
  if (s2.kind === "failure") return failureResult(chemblId);
  if (s2.kind === "none") return { chemblId, availability: "no-structure", cid: null, cidCount: 0 };
  if (s2.kind === "many") return { chemblId, availability: "ambiguous", cid: null, cidCount: s2.count };

  const sdf = await fetchText(`${PUBCHEM_COMPOUND_URL}/cid/${s2.cid}/SDF?record_type=3d`);
  const s3 = interpretSdf3d(sdf.status, sdf.text);
  if (s3.kind === "failure") return failureResult(chemblId);
  return { chemblId, availability: s3.kind === "yes" ? "available" : "no-3d", cid: s2.cid, cidCount: 1 };
}

const cache = makeCache<PubChemResult>();

export function isPubChemCached(chemblId: string): boolean {
  return cache.read(`pubchem:${chemblId}`) !== null;
}

export async function getPubChemResult(chemblId: string): Promise<PubChemResult> {
  if (!CHEMBL_ID_RE.test(chemblId)) {
    throw new Error("getPubChemResult: invalid ChEMBL ID");
  }
  const key = `pubchem:${chemblId}`;
  const cached = cache.read(key);
  if (cached) return cached;
  let result: PubChemResult;
  try {
    result = await lookup(chemblId);
  } catch {
    result = failureResult(chemblId);
  }
  if (result.availability !== "source-failure") cache.write(key, result);
  return result;
}
