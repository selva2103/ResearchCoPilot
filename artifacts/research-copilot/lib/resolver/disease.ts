/**
 * lib/resolver/disease.ts — MedGen Disease Resolution (Step 6)
 *
 * Detection rule (Step 2):
 *   A query is classified as Disease when NCBI MedGen ESearch returns results
 *   and at least one top-ranked concept has a SemanticType consistent with
 *   disease/condition OR the first result's title exactly matches the query.
 *   Confidence is capped at 0.85 (MEDIUM) to enforce user confirmation —
 *   disease queries are often ambiguous (many subtypes; name may match a gene
 *   or organism).
 *
 *   - Exact title match in MedGen (case-insensitive):  confidence 0.85 (MEDIUM)
 *   - Best partial match with disease semantic type:    confidence 0.72 (MEDIUM)
 *   - No disease-typed result in top 5:                return null (fall through)
 *
 * MedGen ESummary response notes (observed from live API, July 2026):
 *   - `semantictype` is returned as `{ "value": "Disease or Syndrome" }` — an
 *     object with a "value" key, NOT a plain string. This differs from some
 *     NCBI documentation.
 *   - `definition` is also an object `{ "value": "..." }` or `{}`.
 *   - The first search result for a broad term (e.g. "Tuberculosis") is often a
 *     specific subtype, not the canonical concept. We fetch retmax=5 and prefer
 *     exact title matches before falling back to the first disease-typed result.
 *
 * Important — Type-independence rule (Step 10):
 *   Even when a disease has a well-known causative organism (e.g. Tuberculosis →
 *   Mycobacterium tuberculosis), queryType stays "Disease".
 *   The causative organism is surfaced in relationships.organisms only.
 *
 * Databases: NCBI MedGen (ESearch + ESummary)
 * Future: elink MedGen→Gene for disease-associated genes (Phase 5.2+)
 */

import {
  NCBI_BASE,
  RESOLVER_RATE_DELAY_MS,
  sleep,
  resolverFetch,
} from "@/lib/resolver/fetch";
import { getAssociatedOrganisms } from "@/lib/resolver/synonyms";
import type { QueryResolution } from "@/types/query-resolution";
import { toConfidenceTier } from "@/types/query-resolution";

// ── Raw NCBI response shapes ──────────────────────────────────────────────────

interface MedGenESearchResult {
  esearchresult: {
    count: string;
    idlist: string[];
  };
}

/**
 * MedGen ESummary entry.
 *
 * IMPORTANT: semantictype is returned as { value: string } (an object),
 * NOT a plain string, despite some docs implying otherwise. We handle both.
 * definition is similarly { value: string } | {}.
 */
interface MedGenESummaryEntry {
  uid: string;
  /** Concept Unique Identifier (CUI) — e.g. "C0041303" for Tuberculosis. */
  conceptid?: string;
  /** Canonical disease name — e.g. "Tuberculosis". */
  title?: string;
  /**
   * Semantic type — observed as { "value": "Disease or Syndrome" } from live API.
   * May also be {} (empty object) for some concepts.
   */
  semantictype?: { value?: string } | string | Record<string, unknown>;
  /** Definition — observed as { "value": "..." } or {}. */
  definition?: { value?: string } | string;
}

interface MedGenESummaryResult {
  result: { uids: string[] } & Record<string, MedGenESummaryEntry>;
}

// ── Semantic type classification ───────────────────────────────────────────────
// Source: UMLS Semantic Type hierarchy for clinical/medical concepts.
// Covers the values observed from live MedGen API.
const DISEASE_SEMANTIC_TYPES = new Set([
  "disease or syndrome",
  "neoplastic process",
  "mental or behavioral dysfunction",
  "congenital abnormality",
  "acquired abnormality",
  "pathologic function",
  "sign or symptom",
  "injury or poisoning",
  "finding",
]);

/**
 * Extract the semantic type string from the MedGen ESummary entry.
 *
 * Handles both { value: string } object format (observed from live API)
 * and legacy plain-string format (documented in some NCBI guides).
 */
function getSemanticTypeString(
  semantictype: MedGenESummaryEntry["semantictype"]
): string | undefined {
  if (!semantictype) return undefined;
  if (typeof semantictype === "string") return semantictype;
  if (typeof semantictype === "object" && "value" in semantictype) {
    return (semantictype as { value?: string }).value;
  }
  return undefined; // {} — unknown; treated permissively below
}

/**
 * Return true when the semantic type indicates a medical/disease concept.
 * Returns true for empty/unknown types from MedGen (which is disease-focused;
 * non-disease concepts are rare and usually excluded by ESearch context).
 */
function isDiseaseSemanticType(
  semantictype: MedGenESummaryEntry["semantictype"]
): boolean {
  const str = getSemanticTypeString(semantictype);
  if (!str) {
    // Empty or unknown — MedGen is a clinical database; treat permissively
    return true;
  }
  return DISEASE_SEMANTIC_TYPES.has(str.toLowerCase());
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Attempt to resolve the query as a MedGen disease / condition concept.
 *
 * Fetches retmax=5 results and:
 *   1. Prefers an exact case-insensitive title match (confidence 0.85)
 *   2. Falls back to the first result with a disease-type semantic type (0.72)
 *   3. Returns null if no disease-typed result found (resolver falls through)
 */
export async function resolveDisease(
  query: string
): Promise<Omit<QueryResolution, "originalQuery"> | null> {
  const q = query.trim();

  // Phase R: strict acceptance. Free-text MedGen/MeSH ESearch ranking is
  // arbitrary (plain words like "river" match disease-typed concepts), so a
  // query is a disease ONLY if (a) MedGen has a concept whose exact title
  // equals the query and is disease-typed, or (b) MeSH has an exact term /
  // entry term equal to the query whose descriptor sits in tree branch C
  // (Diseases). Otherwise return null and let the resolver fall through.
  const normT = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const qClean = q.replace(/"/g, "");
  let best: MedGenESummaryEntry | undefined;
  let viaMesh = false;
  let meshTitle: string | undefined;
  let meshUid: string | undefined;

  const xtitUrl =
    `${NCBI_BASE}/esearch.fcgi?db=medgen` +
    `&term=${encodeURIComponent(`"${qClean}"[XTIT]`)}&retmax=5&retmode=json`;
  const xtitData = (await resolverFetch(xtitUrl)) as MedGenESearchResult;
  const xtitIds = xtitData.esearchresult?.idlist ?? [];
  if (xtitIds.length > 0) {
    await sleep(RESOLVER_RATE_DELAY_MS);
    const summaryUrl =
      `${NCBI_BASE}/esummary.fcgi?db=medgen` +
      `&id=${xtitIds.join(",")}&retmode=json`;
    const summaryData = (await resolverFetch(summaryUrl)) as MedGenESummaryResult;
    const entries = (summaryData.result?.uids ?? [])
      .map((uid) => summaryData.result[uid])
      .filter((e): e is MedGenESummaryEntry => Boolean(e));
    best = entries.find(
      (e) =>
        normT(e.title ?? "") === normT(q) && isDiseaseSemanticType(e.semantictype)
    );
  }

  if (!best) {
    await sleep(RESOLVER_RATE_DELAY_MS);
    const meshSearchUrl =
      `${NCBI_BASE}/esearch.fcgi?db=mesh` +
      `&term=${encodeURIComponent(`"${qClean}"[MESH]`)}&retmax=5&retmode=json`;
    const meshSearch = (await resolverFetch(meshSearchUrl)) as MedGenESearchResult;
    const meshIds = meshSearch.esearchresult?.idlist ?? [];
    if (meshIds.length > 0) {
      await sleep(RESOLVER_RATE_DELAY_MS);
      const meshSummaryUrl =
        `${NCBI_BASE}/esummary.fcgi?db=mesh` +
        `&id=${meshIds.join(",")}&retmode=json`;
      const meshSummary = (await resolverFetch(meshSummaryUrl)) as {
        result?: { uids?: string[] } & Record<string, any>;
      };
      for (const uid of meshSummary.result?.uids ?? []) {
        const e = meshSummary.result?.[uid];
        if (!e) continue;
        const terms: string[] = Array.isArray(e.ds_meshterms) ? e.ds_meshterms : [];
        const exact = terms.some((t) => normT(t) === normT(q));
        const trees =
          JSON.stringify(e.ds_idxlinks ?? "").match(/[A-Z]\d{2}(\.\d+)*/g) ?? [];
        if (exact && trees.some((t) => t.startsWith("C"))) {
          viaMesh = true;
          meshTitle = terms[0];
          meshUid = String(uid);
          break;
        }
      }
    }
  }

  if (!best && !viaMesh) return null;

  const isExact = Boolean(best);
  const confidence = isExact ? 0.85 : 0.8;

  /**
   * normalizedQuery strategy:
   *   - Exact match: use the MedGen canonical title (identical to q anyway).
   *   - Partial match: use the ORIGINAL query, not the subtype title.
   *     Rationale: MedGen's relevance ranking surfaces specific subtypes before
   *     the broad canonical concept for terms like "Tuberculosis" or "Leukemia".
   *     The original query IS the intended canonical form — we just can't
   *     confirm it with certainty (hence MEDIUM confidence).
   *     Surfacing a subtype title (e.g. "Positive Mycobacterium tuberculosis
   *     sputum culture") as normalizedQuery would be actively misleading.
   */
  const normalizedQuery = best ? (best.title ?? q) : q;
  const representativeTitle = best?.title ?? meshTitle ?? q;

  // Associated organisms via hardcoded disease→organism table.
  // Known limitation: hardcoded; see lib/resolver/synonyms.ts DISEASE_ORGANISM_ASSOCIATIONS.
  const associatedOrganisms = getAssociatedOrganisms(q);

  const semanticTypeStr = best ? getSemanticTypeString(best.semantictype) : undefined;

  return {
    normalizedQuery,
    queryType: "Disease",
    confidence,
    confidenceTier: toConfidenceTier(confidence),
    matchedProvider: (viaMesh ? "mesh" : "medgen") as never,
    // Use the representative CUI even for partial matches — it proves MedGen
    // recognised the domain, even if the exact concept wasn't the top hit.
    primaryIdentifier: best ? (best.conceptid ?? best.uid) : `MeSH:${meshUid}`,
    identifierScheme: (best ? "medgen-cui" : "mesh-ui") as never,
    scientificName: normalizedQuery,
    organism: undefined,
    taxonomyId: undefined,
    relationships: {
      organisms: associatedOrganisms.length > 0 ? associatedOrganisms : undefined,
    },
    resolutionPath: (isExact ? "medgen-exact" : "mesh-exact") as never,
    notes: isExact
      ? `Disease concept confirmed via MedGen exact title (${semanticTypeStr ?? "unknown type"}).`
      : `Disease confirmed via MeSH exact term "${representativeTitle}" (tree branch C: Diseases). No exact MedGen title; originalQuery used as normalizedQuery.`,
  };
}
