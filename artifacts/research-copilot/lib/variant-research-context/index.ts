/**
 * lib/variant-research-context/index.ts — VariantResearchContext derivation service (Phase 5.5B-2)
 *
 * PUBLIC API:
 *   getVariantResearchContext(clinvarVariationId, clinvarAccession, variantRecord)
 *     → VariantResearchContext
 *
 * DERIVATION RULES (all non-negotiable):
 *   - Pure derivation from ClinicalEvidence + VariantRecord — ZERO new NCBI calls.
 *   - ClinicalEvidence is retrieved from its existing cache (getClinicalEvidence reuses
 *     the clinicalevidence:{id} namespace). If uncached, it fetches once (same VCV EFetch
 *     call as the clinical-evidence endpoint — no new mechanism).
 *   - This service introduces ONE new cache namespace: variantresearchcontext:{id}.
 *     No new cache implementation, no new TTL policy, no new eviction strategy —
 *     same in-memory Map pattern as every other cache in this codebase.
 *
 * CACHE:
 *   Key:  variantresearchcontext:{clinvarVariationId}
 *   TTL:  24 hours — matches ClinicalEvidence TTL (context is derived from CE; stale CE → stale context).
 *   Implementation: in-memory Map, same pattern as lib/clinical-evidence/index.ts.
 *
 * CONFLICT SUMMARY RULE:
 *   conflictSummary describes the distribution of submission classifications.
 *   It MUST NEVER declare a winner or imply one interpretation is more correct.
 *   The authoritative classification is always ConditionInterpretation.aggregateClassification.
 *
 * CLINICAL SUMMARY RULE:
 *   clinicalSummary is null when:
 *     - no interpretations exist
 *     - all aggregateClassifications are null
 *   Otherwise: one grounded sentence listing conditions and ClinVar's own classifications.
 */

import type { VariantResearchContext } from "@/types/variant-research-context";
import type { VariantRecord } from "@/types/variant-record";
import type { ClinicalEvidence, ClinicalSubmission } from "@/types/clinical-evidence";
import { getClinicalEvidence } from "@/lib/clinical-evidence";

// ── In-memory cache (same abstraction as lib/clinical-evidence/index.ts) ────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — matches ClinicalEvidence TTL

interface CacheEntry {
  data: VariantResearchContext;
  fetchedAt: number;
}

const contextCache = new Map<string, CacheEntry>();

function buildCacheKey(clinvarVariationId: string): string {
  return `variantresearchcontext:${clinvarVariationId}`;
}

function getCached(clinvarVariationId: string): VariantResearchContext | null {
  const key = buildCacheKey(clinvarVariationId);
  const entry = contextCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    contextCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(ctx: VariantResearchContext): void {
  const key = buildCacheKey(ctx.clinvarVariationId);
  contextCache.set(key, { data: ctx, fetchedAt: Date.now() });
}

// ── Derivation helpers ────────────────────────────────────────────────────────

/**
 * Build clinicalSummary from ClinicalEvidence interpretations.
 * Returns null when there are no interpretations or all classifications are null.
 * Never LLM-generated — direct structured extraction.
 */
function deriveClinicalSummary(
  evidence: ClinicalEvidence
): { text: string; source: string } | null {
  const { interpretations } = evidence;
  if (interpretations.length === 0) return null;

  const parts: string[] = [];
  for (const interp of interpretations) {
    const conditionName =
      interp.conditions.map((c) => c.name).join(" / ") || "unspecified condition";
    const classification = interp.aggregateClassification ?? "unclassified";
    parts.push(`${classification} for ${conditionName}`);
  }

  // Require at least one non-null classification to form a grounded sentence
  const hasGroundedClassification = interpretations.some(
    (i) => i.aggregateClassification !== null
  );
  if (!hasGroundedClassification) return null;

  const conditionWord = interpretations.length === 1 ? "condition" : "conditions";
  const text =
    `This variant has ${interpretations.length} ${conditionWord} interpretation${interpretations.length !== 1 ? "s" : ""} in ClinVar: ` +
    parts.join("; ") +
    ".";

  return {
    text,
    source: "ClinicalEvidence.interpretations (condition names + aggregate classifications)",
  };
}

/**
 * Compute submission classification distribution across all interpretations.
 * Returns null when there is 0 or 1 total submission (no meaningful distribution).
 * The text ONLY describes distribution — never declares a winner.
 */
function deriveConflictSummary(
  evidence: ClinicalEvidence
): { text: string; source: string } | null {
  // Collect all submissions across all interpretations
  const allSubmissions: ClinicalSubmission[] = [];
  for (const interp of evidence.interpretations) {
    for (const sub of interp.submissions) {
      allSubmissions.push(sub);
    }
  }

  if (allSubmissions.length <= 1) return null; // No conflict possible with 0 or 1 submission

  // Count by significance label (reusing the same grouping logic as groupSubmissionClassifications)
  const counts = new Map<string, number>();
  for (const sub of allSubmissions) {
    const label = sub.significance ?? "Not provided";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  // Sort by count descending for consistent presentation
  const groups = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label}`);

  const distinctLabels = counts.size;
  const distributionText = groups.join(", ");

  let text: string;
  if (distinctLabels === 1) {
    // All submissions agree — still show the distribution (no conflict), no winner declared
    text = `All ${allSubmissions.length} submission${allSubmissions.length !== 1 ? "s" : ""} classified as: ${distributionText}.`;
  } else {
    // Multiple distinct classifications — show distribution, never declare a winner
    text = `${allSubmissions.length} total submission${allSubmissions.length !== 1 ? "s" : ""} across all conditions: ${distributionText}.`;
  }

  return {
    text,
    source: "ClinicalEvidence.interpretations[*].submissions[*].significance",
  };
}

/**
 * Build the provenance trail for the context.
 */
function buildProvenance(
  evidence: ClinicalEvidence | null,
  variant: VariantRecord
): readonly { source: string; field: string }[] {
  const entries: { source: string; field: string }[] = [];

  entries.push({ source: "VariantRecord (ClinVar ESummary)", field: "geneId, geneSymbol, organism, transcriptConsequences" });

  if (evidence && evidence.interpretations.length > 0) {
    entries.push({ source: "ClinicalEvidence (ClinVar VCV EFetch XML)", field: "interpretations: conditions, aggregateClassification, submissions" });
  }

  if (variant.transcriptConsequences.length > 0) {
    const tc = variant.transcriptConsequences[0];
    if (tc.proteinAccession) {
      entries.push({ source: "VariantRecord.transcriptConsequences", field: "proteinAccession" });
    }
  }

  return entries;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Derive a VariantResearchContext from ClinicalEvidence + VariantRecord.
 *
 * No new NCBI API calls beyond what ClinicalEvidence already makes.
 * The ClinicalEvidence is retrieved from its own cache if available.
 *
 * @param clinvarVariationId  - Numeric variation ID, e.g. "4685939"
 * @param clinvarAccession    - VCV-prefixed accession e.g. "VCV004685939" (or null → auto-constructed)
 * @param variantRecord       - The VariantRecord for this variant (already in client state)
 */
export async function getVariantResearchContext(
  clinvarVariationId: string,
  clinvarAccession: string | null,
  variantRecord: VariantRecord
): Promise<VariantResearchContext> {
  // ── Cache check ──────────────────────────────────────────────────────────────
  const cached = getCached(clinvarVariationId);
  if (cached !== null) return cached;

  // ── Retrieve ClinicalEvidence (from its cache or fetch) ──────────────────────
  // getClinicalEvidence reuses the existing clinicalevidence:{id} namespace.
  // If the user already expanded CE for this variant, this is a free cache hit.
  // If not, it makes the same VCV EFetch call the CE endpoint would — no new mechanism.
  let evidence: ClinicalEvidence | null = null;
  try {
    evidence = await getClinicalEvidence(clinvarVariationId, clinvarAccession);
  } catch {
    // CE fetch failed — still derive what we can from VariantRecord alone
    evidence = null;
  }

  // ── Derive each field ────────────────────────────────────────────────────────
  const clinicalSummary = evidence ? deriveClinicalSummary(evidence) : null;
  const conflictSummary = evidence ? deriveConflictSummary(evidence) : null;

  // transcriptContext: reuse from VariantRecord verbatim
  const transcriptContext = variantRecord.transcriptConsequences;

  // relationships: from VariantRecord fields
  const firstConsequence = variantRecord.transcriptConsequences[0] ?? null;
  const relationships = {
    geneId: variantRecord.geneId,
    geneSymbol: variantRecord.geneSymbol,
    transcriptAccession: firstConsequence?.transcriptAccession ?? null,
    proteinAccession: firstConsequence?.proteinAccession ?? null,
    organism: variantRecord.organism,
  };

  const provenance = buildProvenance(evidence, variantRecord);

  const ctx: VariantResearchContext = {
    clinvarVariationId,
    clinicalSummary,
    conflictSummary,
    transcriptContext,
    relationships,
    provenance,
  };

  setCached(ctx);
  return ctx;
}
