/**
 * lib/protein/research-context.ts — Phase 5.4B
 *
 * Pure derivation functions for ProteinResearchContext. None of these functions
 * make network calls — all inputs are already-fetched data passed as arguments.
 *
 * ── Extraction rules (documented as required by Phase 5.4B spec) ──────────────
 *
 * deriveSummary (source: "RefSeq GenPept COMMENT" or "RefSeq GenPept DEFINITION"):
 *   1. Extract the COMMENT section (text between "COMMENT     " and the next
 *      top-level GenPept section header on a new line with no leading space).
 *   2. Within COMMENT, look for a "Summary:" paragraph — if found, extract its
 *      text as the primary result. Clean up "[provided by RefSeq, ...]" suffix.
 *   3. Fallback: use the first substantive paragraph of COMMENT that is not
 *      purely administrative (does not start with "REVIEWED REFSEQ:" or "On ").
 *   4. Final fallback: extract the DEFINITION line (first line value after
 *      "DEFINITION  "), stripping the organism suffix in [brackets].
 *   5. If nothing substantive is found, return null.
 *
 * deriveRoleChips (sources: "RefSeq GenPept KEYWORDS" and
 * "RefSeq GenPept FEATURES — Region/Site"):
 *   KEYWORDS pass:
 *   1. Extract the KEYWORDS line(s): text after "KEYWORDS    " until the
 *      next top-level section header. Join continuation lines.
 *   2. Split the resulting string by "; " (semicolon-space).
 *   3. Filter out literal "." (empty KEYWORDS), empty strings, and single-
 *      character tokens.
 *   4. Filter out curation/database metadata terms that are NOT biological
 *      role annotations (e.g. "RefSeq", "RefSeq Select", "MANE Select",
 *      "MANE Select Plus Clinical", "Reference proteome"). These terms
 *      describe the record's curation status, not the protein's biological
 *      function, and must never be surfaced as if they were a role.
 *   5. Each surviving term becomes a chip with source "RefSeq GenPept KEYWORDS".
 *
 *   FEATURES pass (audit-confirmed gap — FEATURES were previously unused
 *   despite being specified as a source of role chips):
 *   6. Parse the FEATURES table for `Region` and `Site` feature entries.
 *   7. Region: take the `/region_name="..."` value, strip a trailing period
 *      and any embedded `/evidence=...` fragment. Skip values matching
 *      /^(interaction with|required for interaction with)/i — those name a
 *      binding partner, not an intrinsic biological role, and skip anything
 *      longer than 60 characters (motif/coordinate noise, not a short label).
 *      Chip label: "Region: {region_name}". Source: "RefSeq GenPept FEATURES — Region".
 *   8. Site: take the `/site_type="..."` value, skip the generic "other".
 *      Distinct site types are de-duplicated (many individual residues share
 *      the same site_type, e.g. dozens of "phosphorylation" sites collapse to
 *      one chip). Chip label: "Site: {site_type}". Source:
 *      "RefSeq GenPept FEATURES — Site".
 *   9. Both passes de-duplicate case-insensitively against each other and
 *      against the KEYWORDS chips already collected.
 *
 *   Combine + cap:
 *   10. Concatenate KEYWORDS chips then FEATURES chips (Region before Site),
 *       de-duplicated, and return the first 8.
 *   11. If nothing remains after filtering across both passes, return [] —
 *       the UI omits the role-chips section entirely rather than showing
 *       metadata or noise as if it were a biological role.
 *   Note: never maintain a curated mapping of gene symbol → role. The chips
 *   are data-driven from this specific protein's GenPept record only.
 *
 * computeAnnotationConfidence (internal evidence coverage signal):
 *   Signals scored (0 = absent, 1 = present):
 *     A. COMMENT — non-empty COMMENT section
 *     B. DEFINITION — non-empty DEFINITION line
 *     C. KEYWORDS — at least one non-trivial keyword
 *     D. proteinName — non-null (from /product= in FEATURES, already on ProteinRecord)
 *     E. molecularWeight — non-null (from /calculated_mol_wt=, already on ProteinRecord)
 *   Coverage fraction = sum(A+B+C+D+E) / 5
 *   Label rules:
 *     "well-annotated" — signal A present AND total ≥ 3 (≥ 60% coverage with COMMENT)
 *     "limited"        — total ≥ 2 but not "well-annotated" (A absent, or total 2/5)
 *     "unavailable"    — total ≤ 1
 *   The raw signal set {A,B,C,D,E} and coverage fraction are logged for
 *   future quality metrics but are NOT included in the returned label.
 *
 * mapResolutionConfidence (read-only translation of Phase R score):
 *   - NormalizedQuery.ambiguous === true                    → "ambiguous"
 *   - NormalizedQuery.confidence ≥ 0.90 (and not ambiguous) → "high"
 *   - NormalizedQuery.confidence ≥ 0.70 (and not ambiguous) → "medium"
 *   - NormalizedQuery.confidence ≥ 0.50 (and not ambiguous) → "low"
 *   - NormalizedQuery.confidence <  0.50 (and not ambiguous) → "ambiguous"
 *   This function NEVER modifies NormalizedQuery.confidence or any other
 *   field. It is a label translation only.
 *
 * deriveBiologicalImportance (source: "Gene Explorer NCBI Gene summary"):
 *   - If GeneRecord.omimId is null  → return null (no disease association known)
 *   - If GeneRecord.summary is null → return null (too sparse)
 *   - This must answer "why researchers study this" (disease/OMIM significance),
 *     NOT "what it does" (that's deriveSummary's job from the separate GenPept
 *     COMMENT source). To avoid duplicating deriveSummary's typical opening
 *     sentence (which is usually the generic protein-function sentence shared
 *     by both GenPept COMMENT and the NCBI Gene summary's first sentence),
 *     this function specifically looks for a disease/mutation-association
 *     sentence rather than blindly taking the first substantive sentence.
 *   - Scan GeneRecord.summary sentence by sentence (> 40 characters) and return
 *     the first one that contains a disease/OMIM-association signal (matches
 *     /mutation|disease|cancer|syndrome|disorder|associated with|deficiency/i)
 *     and is not a generic filler opener.
 *   - If no such disease-association sentence is found → return null (do NOT
 *     fall back to a generic/duplicate sentence).
 *   - Otherwise: { text: <first disease-association sentence>, source: <...> }
 *
 * buildRelationships:
 *   Returns the Gene → Transcript → Protein → Species chain using data
 *   already in memory. No API calls.
 */

import type { ProteinRecord } from "@/types/protein-record";
import type { TranscriptRecord } from "@/types/transcript-record";
import type { GeneRecord } from "@/types/gene-record";
import type { NormalizedQuery } from "@/types/normalized-query";
import type { ProteinResearchContext } from "@/types/research-context";

// ─── Internal GenPept text extraction helpers ──────────────────────────────────

/** Extract the value of a top-level GenPept field (e.g. DEFINITION, KEYWORDS, COMMENT).
 *  Returns the text starting after the 12-char field tag, with continuation lines
 *  joined (continuation lines begin with spaces).
 */
function extractGenPeptField(genPeptText: string, field: string): string {
  const fieldTag = field.padEnd(12); // e.g. "DEFINITION  "
  const startIdx = genPeptText.indexOf(fieldTag);
  if (startIdx === -1) return "";

  // Collect lines until the next top-level header (line with no leading space
  // that starts with a capital letter or digit or "//").
  const fromField = genPeptText.slice(startIdx + 12); // skip the field tag
  const lines = fromField.split("\n");
  const collected: string[] = [];

  for (const line of lines) {
    if (collected.length === 0) {
      // First line — always part of this field.
      collected.push(line.trimEnd());
    } else if (line === "" || line.startsWith(" ") || line.startsWith("\t")) {
      // Continuation line (blank or indented).
      collected.push(line.trimEnd());
    } else {
      // New top-level section — stop.
      break;
    }
  }

  return collected
    .map((l) => l.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── deriveSummary ─────────────────────────────────────────────────────────────

/**
 * Extract a biological summary sentence from GenPept COMMENT and/or DEFINITION.
 *
 * Structured extraction only — no inference or invented content.
 * See module JSDoc for the exact extraction rule.
 */
export function deriveSummary(
  genPeptText: string
): { text: string; source: string } | null {
  const comment = extractGenPeptField(genPeptText, "COMMENT");

  // 1. Look for "Summary:" paragraph in COMMENT (the most specific text).
  if (comment) {
    const summaryMarker = "Summary:";
    const markerIdx = comment.indexOf(summaryMarker);
    if (markerIdx !== -1) {
      let raw = comment.slice(markerIdx + summaryMarker.length).trim();
      // Strip "[provided by RefSeq, ...]" or "[provided by ...]" suffix.
      raw = raw.replace(/\s*\[provided by[^\]]*\]/gi, "").trim();
      // Strip trailing period if ends with one; we'll re-add.
      raw = raw.replace(/\.$/, "").trim();
      if (raw.length > 20) {
        return {
          text: raw.charAt(0).toUpperCase() + raw.slice(1),
          source: "RefSeq GenPept COMMENT (Summary paragraph)",
        };
      }
    }

    // 2. Fallback: first substantive paragraph of COMMENT that isn't administrative.
    //    Administrative lines start with "REVIEWED REFSEQ:", "On ", "This sequence",
    //    "The reference sequence", "Publication Note", "COMPLETENESS".
    const adminPrefixes = [
      "REVIEWED REFSEQ:",
      "On ",
      "This sequence",
      "The reference sequence",
      "Publication Note",
      "COMPLETENESS",
      "INFERRED REFSEQ:",
      "MODEL REFSEQ:",
      "PROVISIONAL REFSEQ:",
    ];
    // Split COMMENT into sentences by period-space or period-newline.
    const sentences = comment
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40);
    for (const sentence of sentences) {
      const isAdmin = adminPrefixes.some((p) =>
        sentence.startsWith(p)
      );
      if (!isAdmin) {
        const cleaned = sentence.replace(/\s*\[provided by[^\]]*\]/gi, "").trim();
        if (cleaned.length > 40) {
          return {
            text: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
            source: "RefSeq GenPept COMMENT",
          };
        }
      }
    }
  }

  // 3. Final fallback: DEFINITION line, stripping "[Organism]" suffix.
  const definition = extractGenPeptField(genPeptText, "DEFINITION");
  if (definition.length > 10) {
    const cleaned = definition.replace(/\s*\[[^\]]+\]\s*\.?\s*$/, "").trim();
    if (cleaned.length > 10) {
      return {
        text: cleaned.charAt(0).toUpperCase() + cleaned.slice(1),
        source: "RefSeq GenPept DEFINITION",
      };
    }
  }

  return null;
}

// ─── deriveRoleChips ──────────────────────────────────────────────────────────

/**
 * Extract biological role chips from GenPept KEYWORDS.
 *
 * Data-driven: never maps gene symbols to roles via a curated table.
 * See module JSDoc for the exact extraction rule.
 */
// Curation/database metadata terms that appear in the GenPept KEYWORDS field
// but describe the record's curation status, not the protein's biological
// role/function. These must never be surfaced as if they were a biological
// role chip. Matched case-insensitively against the full chip text.
const NON_BIOLOGICAL_KEYWORD_TERMS = new Set(
  [
    "RefSeq",
    "RefSeq Select",
    "MANE Select",
    "MANE Select Plus Clinical",
    "MANE Plus Clinical",
    "Reference proteome",
    "Complete proteome",
  ].map((t) => t.toLowerCase())
);

/** Region /region_name values that name a binding partner rather than an
 *  intrinsic biological role (e.g. "Interaction with CCAR2") — excluded from
 *  role chips per the module JSDoc.
 */
const PARTNER_INTERACTION_RE = /^(interaction with|required for interaction with)/i;

/** Site /site_type values that are too generic to serve as a role label. */
const GENERIC_SITE_TYPES = new Set(["other"]);

/**
 * Extract Region/Site role-chip candidates directly from the raw FEATURES
 * table text (line-oriented parse — FEATURES is a fixed-column GenPept table,
 * not free text, so it is parsed independently of extractGenPeptField).
 */
function extractFeatureRoleChips(
  genPeptText: string
): { label: string; source: string }[] {
  const featuresIdx = genPeptText.indexOf("FEATURES");
  if (featuresIdx === -1) return [];
  // FEATURES runs until the ORIGIN section (the raw sequence block).
  const originIdx = genPeptText.indexOf("\nORIGIN", featuresIdx);
  const featuresBlock =
    originIdx === -1
      ? genPeptText.slice(featuresIdx)
      : genPeptText.slice(featuresIdx, originIdx);

  const lines = featuresBlock.split("\n");

  const regionNames: string[] = [];
  const siteTypes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const regionMatch = line.match(/^\s*Region\s+\S+/);
    const siteMatch = line.match(/^\s*Site\s+\S+/);

    if (regionMatch) {
      // The /region_name qualifier may span multiple continuation lines
      // (closing on the line containing the terminating quote).
      let j = i + 1;
      let raw = "";
      let foundTag = false;
      while (j < lines.length && /^\s{20,}/.test(lines[j])) {
        const qualLine = lines[j].trim();
        if (!foundTag) {
          const tagMatch = qualLine.match(/^\/region_name="(.*)$/);
          if (tagMatch) {
            foundTag = true;
            raw = tagMatch[1];
            if (raw.endsWith('"')) break;
          }
        } else {
          if (qualLine.startsWith("/")) break; // next qualifier — region_name closed without quote on same fragment
          raw += " " + qualLine;
          if (raw.includes('"')) break;
        }
        j++;
      }
      if (foundTag) {
        const cleaned = raw.replace(/".*$/, "").replace(/\.$/, "").trim();
        if (
          cleaned.length > 1 &&
          cleaned.length <= 60 &&
          !PARTNER_INTERACTION_RE.test(cleaned)
        ) {
          regionNames.push(cleaned);
        }
      }
    } else if (siteMatch) {
      // Scan the full indented qualifier block for /site_type=, the same way
      // Region scans for /region_name= — /site_type is not always the very
      // first qualifier line (e.g. an /order(...) location continuation or
      // another qualifier can precede it).
      let j = i + 1;
      while (j < lines.length && /^\s{20,}/.test(lines[j])) {
        const qualLine = lines[j].trim();
        const tagMatch = qualLine.match(/^\/site_type="([^"]*)"/);
        if (tagMatch) {
          const cleaned = tagMatch[1].trim();
          if (cleaned.length > 1 && !GENERIC_SITE_TYPES.has(cleaned.toLowerCase())) {
            siteTypes.push(cleaned);
          }
          break;
        }
        // Stop scanning once we reach the next feature's location line
        // (unindented relative to qualifiers) — handled by the outer while
        // condition already; here we just continue past non-matching quals.
        j++;
      }
    }
  }

  const seen = new Set<string>();
  const chips: { label: string; source: string }[] = [];

  for (const name of regionNames) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ label: `Region: ${name}`, source: "RefSeq GenPept FEATURES — Region" });
  }
  for (const type of siteTypes) {
    const key = type.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ label: `Site: ${type}`, source: "RefSeq GenPept FEATURES — Site" });
  }

  return chips;
}

export function deriveRoleChips(
  genPeptText: string
): ProteinResearchContext["roleChips"] {
  const keywords = extractGenPeptField(genPeptText, "KEYWORDS");

  const keywordChips: { label: string; source: string }[] = [];
  if (keywords && keywords !== ".") {
    const terms = keywords
      .split(/;\s*/)
      .map((k) => k.replace(/\.$/, "").trim())
      .filter((k) => k.length > 1 && k !== ".")
      .filter((k) => !NON_BIOLOGICAL_KEYWORD_TERMS.has(k.toLowerCase()));
    for (const label of terms) {
      keywordChips.push({ label, source: "RefSeq GenPept KEYWORDS" });
    }
  }

  const featureChips = extractFeatureRoleChips(genPeptText);

  const seen = new Set<string>();
  const combined: { label: string; source: string }[] = [];
  for (const chip of [...keywordChips, ...featureChips]) {
    const key = chip.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(chip);
  }

  return combined.slice(0, 8);
}

// ─── deriveCanonicalExplanation ────────────────────────────────────────────────

/**
 * Return a plain-language sentence about this protein's canonical/isoform status.
 *
 * Follows the null-not-false rule: isCanonical === null for non-human genes —
 * no canonical/non-canonical claim is made for organisms where MANE does not apply.
 */
export function deriveCanonicalExplanation(
  proteinRecord: ProteinRecord,
  transcriptRecord: TranscriptRecord
): string {
  if (proteinRecord.isCanonical === true) {
    const mane = transcriptRecord.maneSelectAccession
      ? ` (MANE Select transcript: ${transcriptRecord.maneSelectAccession})`
      : "";
    return `This protein is the canonical RefSeq isoform for this gene${mane}.`;
  }

  if (proteinRecord.isCanonical === false) {
    const canonicalAccession =
      transcriptRecord.maneSelectAccession ?? "not determined";
    return (
      `This is an alternative isoform. The MANE Select transcript for this gene is ` +
      `${canonicalAccession}.`
    );
  }

  // isCanonical === null — non-human gene, MANE does not apply.
  return (
    `Canonical isoform designation does not apply to this protein — ` +
    `the MANE Select system is defined for human genes only.`
  );
}

// ─── computeAnnotationConfidence ──────────────────────────────────────────────

/**
 * Internal evidence coverage signal (logged but not exposed on the returned type).
 * @internal
 */
interface AnnotationSignals {
  hasComment: boolean;
  hasDefinition: boolean;
  hasKeywords: boolean;
  hasProteinName: boolean;
  hasMolecularWeight: boolean;
  coverageFraction: number;
}

function buildAnnotationSignals(
  genPeptText: string,
  proteinRecord: ProteinRecord
): AnnotationSignals {
  const comment = extractGenPeptField(genPeptText, "COMMENT");
  const definition = extractGenPeptField(genPeptText, "DEFINITION");
  const keywords = extractGenPeptField(genPeptText, "KEYWORDS");

  const hasComment = comment.length > 20;
  const hasDefinition = definition.length > 10;
  const hasKeywords = keywords.length > 1 && keywords !== ".";
  const hasProteinName = Boolean(proteinRecord.proteinName);
  const hasMolecularWeight = proteinRecord.molecularWeight != null;

  const present =
    [hasComment, hasDefinition, hasKeywords, hasProteinName, hasMolecularWeight].filter(
      Boolean
    ).length;

  return {
    hasComment,
    hasDefinition,
    hasKeywords,
    hasProteinName,
    hasMolecularWeight,
    coverageFraction: present / 5,
  };
}

/**
 * Derive annotation confidence from GenPept completeness signals.
 * Logs the internal evidence coverage signal for future quality metrics.
 * See module JSDoc for the exact rule.
 */
export function computeAnnotationConfidence(
  genPeptText: string,
  proteinRecord: ProteinRecord
): ProteinResearchContext["annotationConfidence"] {
  const signals = buildAnnotationSignals(genPeptText, proteinRecord);

  // Log for future quality metric collection (not displayed in UI).
  // eslint-disable-next-line no-console
  console.log(
    `[research-context] annotation-signals ${proteinRecord.proteinAccessionVersion}: ` +
      `comment=${signals.hasComment} definition=${signals.hasDefinition} ` +
      `keywords=${signals.hasKeywords} proteinName=${signals.hasProteinName} ` +
      `mw=${signals.hasMolecularWeight} coverage=${signals.coverageFraction.toFixed(2)}`
  );

  const presentCount = Math.round(signals.coverageFraction * 5);

  if (signals.hasComment && presentCount >= 3) return "well-annotated";
  if (presentCount >= 2) return "limited";
  return "unavailable";
}

// ─── mapResolutionConfidence ───────────────────────────────────────────────────

/**
 * Translate Phase R's numeric resolver confidence (and ambiguous flag) to a
 * researcher-facing label. READ-ONLY — never modifies the NormalizedQuery object.
 *
 * Mapping rule (see module JSDoc for the full table):
 *   ambiguous → "ambiguous"
 *   ≥ 0.90    → "high"
 *   ≥ 0.70    → "medium"
 *   ≥ 0.50    → "low"
 *   < 0.50    → "ambiguous"
 */
export function mapResolutionConfidence(
  confidence: number,
  ambiguous: boolean
): ProteinResearchContext["resolutionConfidence"] {
  if (ambiguous) return "ambiguous";
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  if (confidence >= 0.5) return "low";
  return "ambiguous";
}

// ─── deriveBiologicalImportance ───────────────────────────────────────────────

/**
 * Derive a biological importance statement from GeneRecord's already-fetched
 * OMIM/disease association data. Makes no new network calls.
 *
 * Graceful degradation: returns null rather than a generic filler sentence
 * when the underlying data is absent or too sparse for a specific claim.
 *
 * See module JSDoc for the exact rule.
 */
export function deriveBiologicalImportance(
  geneRecord: GeneRecord
): ProteinResearchContext["biologicalImportance"] {
  // Requirement: only produce output when OMIM ID is present on the GeneRecord.
  if (!geneRecord.omimId) return null;
  // Requirement: only produce output when NCBI Gene curated summary is present.
  if (!geneRecord.summary || geneRecord.summary.trim().length < 30) return null;

  // Generic openers like "This gene encodes a protein..." describe function,
  // not disease significance — they belong to deriveSummary's territory and
  // must never be surfaced here (that would duplicate Summary).
  const genericOpenings = [
    /^this gene encodes a protein\.?$/i,
    /^this gene encodes a (protein|enzyme|receptor)\s+that/i,
    /^the protein encoded by this gene/i,
  ];

  // Biological Importance must answer "why researchers study this" — i.e. a
  // disease/OMIM-association claim — not "what it does". Require an explicit
  // disease/mutation-association signal so this can never collapse into a
  // near-duplicate of deriveSummary's GenPept-sourced function sentence.
  const diseaseAssociationSignal =
    /mutation|disease|cancer|tumou?r(?!\s+suppressor\s+protein\b)|syndrome|disorder|associated with|deficiency|carcinoma|pathogenic|linked to|implicated in|susceptibility|predispos|risk of|causes?\s|caused by|malignan/i;

  const sentences = geneRecord.summary
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);

  for (const sentence of sentences) {
    const isGeneric = genericOpenings.some((re) => re.test(sentence));
    if (isGeneric) continue;
    if (!diseaseAssociationSignal.test(sentence)) continue;
    return {
      text: sentence.charAt(0).toUpperCase() + sentence.slice(1),
      source: `Gene Explorer NCBI Gene summary — disease association (OMIM ref: ${geneRecord.omimId})`,
    };
  }

  // No genuine disease-association sentence found — omit rather than
  // fabricate or fall back to a generic/duplicate function sentence.
  return null;
}

// ─── buildRelationships ───────────────────────────────────────────────────────

/**
 * Build the Gene → Transcript → Protein → Species chain from data already
 * in memory. No API calls.
 */
export function buildRelationships(
  geneRecord: GeneRecord,
  transcriptRecord: TranscriptRecord,
  proteinRecord: ProteinRecord
): ProteinResearchContext["relationships"] {
  return {
    gene: `${geneRecord.officialSymbol} (Gene ID: ${geneRecord.geneId})`,
    transcript: transcriptRecord.accessionVersion,
    protein: proteinRecord.proteinAccessionVersion,
    species: `${geneRecord.organism} (TaxID: ${geneRecord.taxonomyId})`,
  };
}
