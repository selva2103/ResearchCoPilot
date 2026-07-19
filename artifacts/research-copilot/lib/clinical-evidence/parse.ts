/**
 * lib/clinical-evidence/parse.ts — ClinVar VCV XML → ClinicalEvidence (Phase 5.5B-1)
 *
 * Parses the raw VCV EFetch XML response into the ClinicalEvidence contract.
 *
 * PARSING STRATEGY: Targeted string/regex extraction — no XML DOM library.
 * The ClinVar VCV XML has a well-defined, predictable structure. This avoids
 * adding external parsing dependencies and matches the approach used throughout
 * the rest of this codebase (see lib/transcript/genbank.ts).
 *
 * SCV-TO-RCV MAPPING:
 *   Each SCV (ClinicalAssertion) is matched to its parent RCV by MedGen CUI:
 *   1. Build a Map<MedGenCUI, ConditionInterpretation> from RCVList
 *   2. For each SCV, iterate its TraitSet/Trait/XRef elements
 *   3. First MedGen DB match → SCV belongs to that RCV
 *   4. Non-MedGen XRefs (OMIM etc.) → if only one RCV exists, assign to it
 *      otherwise → SCV is "unlinked" (preserved with conditionAsserted=null)
 *
 * DETERMINISTIC FAILURE HANDLING:
 *   If one ConditionInterpretation fails to parse, skip it while preserving all
 *   others. If the entire ClassifiedRecord is absent (variant with no formal
 *   interpretation), return empty interpretations array — not an error.
 *
 * GERMLINE ONLY:
 *   Somatic/oncogenicity classifications (separate XML sections) are out of
 *   scope for 5.5B-1. GermlineClassification elements only.
 */

import type {
  ClinicalEvidence,
  ConditionInterpretation,
  ClinicalCondition,
  ClinicalSubmission,
} from "@/types/clinical-evidence";

// ── XML utility helpers ────────────────────────────────────────────────────────

/** Decode standard XML entities to plain text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Extract a named attribute value from an XML tag string or opening element. */
function attr(xml: string, attrName: string): string | null {
  const re = new RegExp(`(?:^|\\s)${attrName}="([^"]*)"`, "i");
  const m = re.exec(xml);
  return m ? decodeEntities(m[1]) : null;
}

/** Extract text content of the first matching simple element (no nested children). */
function textOf(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "i");
  const m = re.exec(xml);
  return m ? decodeEntities(m[1].trim()) : null;
}

/** Find the outer XML of all occurrences of a top-level element by tag name. */
function findAllBlocks(xml: string, tagName: string): string[] {
  const blocks: string[] = [];
  const openTag = `<${tagName} `;
  const openTagNoAttr = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  let pos = 0;

  while (pos < xml.length) {
    let start = xml.indexOf(openTag, pos);
    const startNoAttr = xml.indexOf(openTagNoAttr, pos);

    // Pick whichever comes first
    if (start === -1 && startNoAttr === -1) break;
    if (start === -1) start = startNoAttr;
    else if (startNoAttr !== -1 && startNoAttr < start) start = startNoAttr;

    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;

    blocks.push(xml.slice(start, end + closeTag.length));
    pos = end + closeTag.length;
  }
  return blocks;
}

/** Extract the content BETWEEN two tags (first match). */
function innerContent(xml: string, tagName: string): string | null {
  const openRe = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "i");
  const openM = openRe.exec(xml);
  if (!openM) return null;
  const start = openM.index + openM[0].length;
  const closeTag = `</${tagName}>`;
  const end = xml.indexOf(closeTag, start);
  if (end === -1) return null;
  return xml.slice(start, end);
}

// ── RCV parsing ────────────────────────────────────────────────────────────────

interface ParsedRCV {
  rcvAccession: string;
  conditions: ClinicalCondition[];
  aggregateClassification: string | null;
  aggregateReviewStatus: string | null;
  lastEvaluated: string | null;
  submissionCount: number;
  medGenCUIs: string[];   // for SCV mapping; not in the final type
}

function parseRCVAccession(rcvXml: string): ParsedRCV | null {
  try {
    const rcvAccession = attr(rcvXml, "Accession");
    if (!rcvAccession) return null;

    // Conditions from ClassifiedConditionList
    const condListContent = innerContent(rcvXml, "ClassifiedConditionList") ?? "";
    const condBlocks = findAllBlocks(condListContent, "ClassifiedCondition");
    const conditions: ClinicalCondition[] = [];
    const medGenCUIs: string[] = [];

    for (const condBlock of condBlocks) {
      const db = attr(condBlock, "DB");
      const id = attr(condBlock, "ID");
      // Text content of ClassifiedCondition is the condition name
      const name = decodeEntities(
        condBlock.replace(/<ClassifiedCondition[^>]*>/, "").replace(/<\/ClassifiedCondition>/, "").trim()
      );
      const identifiers: { database: string; id: string }[] = [];
      if (db && id) {
        identifiers.push({ database: db, id });
        if (db === "MedGen") medGenCUIs.push(id);
      }
      if (name) conditions.push({ name, identifiers });
    }

    // GermlineClassification section (5.5B-1 scope only)
    const germlineContent = innerContent(rcvXml, "GermlineClassification");
    let aggregateClassification: string | null = null;
    let aggregateReviewStatus: string | null = null;
    let lastEvaluated: string | null = null;
    let submissionCount = 0;

    if (germlineContent) {
      aggregateReviewStatus = textOf(germlineContent, "ReviewStatus");

      // Description has the classification text + SubmissionCount + DateLastEvaluated attributes
      const descRe = /<Description([^>]*)>([^<]*)<\/Description>/i;
      const descM = descRe.exec(germlineContent);
      if (descM) {
        const descAttrs = descM[1];
        const descText = decodeEntities(descM[2].trim());
        aggregateClassification = descText || null;

        const scAttr = attr(descAttrs, "SubmissionCount");
        if (scAttr) submissionCount = parseInt(scAttr, 10) || 0;

        lastEvaluated = attr(descAttrs, "DateLastEvaluated");
      }
    }

    return {
      rcvAccession,
      conditions,
      aggregateClassification,
      aggregateReviewStatus,
      lastEvaluated,
      submissionCount,
      medGenCUIs,
    };
  } catch {
    return null;
  }
}

// ── SCV parsing ────────────────────────────────────────────────────────────────

interface ParsedSCV {
  scvAccession: string;
  significance: string | null;
  reviewStatus: string | null;
  submitter: string | null;
  lastEvaluated: string | null;
  contributesToAggregate: boolean;
  medGenXRefs: string[];  // MedGen CUIs from TraitSet/Trait/XRef for mapping
  omimXRefs: string[];    // OMIM IDs (fallback mapping)
}

function parseClinicalAssertion(caXml: string): ParsedSCV | null {
  try {
    const contributesToAggregate =
      attr(caXml, "ContributesToAggregateClassification")?.toLowerCase() !== "false";

    // SCV accession + submitter
    const scvAccBlock = (() => {
      const re = /<ClinVarAccession[^>]+Type="SCV"[^>]*/;
      const m = re.exec(caXml);
      return m ? m[0] : "";
    })();
    const scvAccession = attr(scvAccBlock, "Accession");
    if (!scvAccession) return null;
    const submitter = attr(scvAccBlock, "SubmitterName");

    // Classification section
    const classContent = innerContent(caXml, "Classification");
    let significance: string | null = null;
    let reviewStatus: string | null = null;
    let lastEvaluated: string | null = null;

    if (classContent) {
      reviewStatus = textOf(classContent, "ReviewStatus");
      significance = textOf(classContent, "GermlineClassification");
      // DateLastEvaluated is attribute on <Classification>
      const classOpenRe = /<Classification([^>]*)>/i;
      const classM = classOpenRe.exec(caXml);
      if (classM) lastEvaluated = attr(classM[1], "DateLastEvaluated");
    }

    // TraitSet XRefs for SCV-to-RCV mapping
    const medGenXRefs: string[] = [];
    const omimXRefs: string[] = [];
    const traitSetContent = innerContent(caXml, "TraitSet") ?? "";
    const xrefRe = /<XRef(?:\s[^>]*)?\s*\/?>(?:\s*<\/XRef>)?/gi;
    let xrefM: RegExpExecArray | null;
    while ((xrefM = xrefRe.exec(traitSetContent)) !== null) {
      const xrefXml = xrefM[0];
      const db = attr(xrefXml, "DB");
      const id = attr(xrefXml, "ID");
      if (db && id) {
        if (db === "MedGen") medGenXRefs.push(id);
        else if (db === "OMIM") omimXRefs.push(id);
      }
    }

    // Fallback: extract MedGen CUI from localKey attribute of ClinVarSubmissionID
    // Format: "{id}|MedGen:{CUI}" or "{id}|OMIM:{id}"
    const localKeyRe = /<ClinVarSubmissionID[^>]+localKey="([^"]*)"/i;
    const localKeyM = localKeyRe.exec(caXml);
    if (localKeyM) {
      const localKey = localKeyM[1];
      const medGenKeyM = /\|MedGen:(C\d+)/i.exec(localKey);
      if (medGenKeyM && !medGenXRefs.includes(medGenKeyM[1])) {
        medGenXRefs.push(medGenKeyM[1]);
      }
    }

    return {
      scvAccession,
      significance,
      reviewStatus,
      submitter,
      lastEvaluated,
      contributesToAggregate,
      medGenXRefs,
      omimXRefs,
    };
  } catch {
    return null;
  }
}

// ── Main parse entry point ─────────────────────────────────────────────────────

/**
 * Parse a ClinVar VCV EFetch XML response into a ClinicalEvidence object.
 *
 * @param xml - Raw XML string from clinvar-retrieval.ts
 * @param clinvarVariationId - The numeric variation ID (for the result key)
 * @returns ClinicalEvidence with 0+ interpretations, or null if the XML is
 *   fundamentally malformed (e.g. empty <set/> response — should be caught earlier)
 */
export function parseClinVarVCVXml(
  xml: string,
  clinvarVariationId: string
): ClinicalEvidence | null {
  // Sanity check
  if (!xml.includes("<VariationArchive")) return null;

  // ── Step 1: Parse all RCVs ───────────────────────────────────────────────────
  const rcvListContent = innerContent(xml, "RCVList") ?? "";
  const rcvBlocks = findAllBlocks(rcvListContent, "RCVAccession");
  const parsedRCVs: ParsedRCV[] = rcvBlocks
    .map((block) => parseRCVAccession(block))
    .filter((r): r is ParsedRCV => r !== null);

  // ── Step 2: Build lookup from MedGen CUI → RCV index ──────────────────────
  // Keyed by MedGen CUI for SCV-to-RCV mapping
  const rcvByMedGen = new Map<string, number>(); // CUI → index in parsedRCVs
  for (let i = 0; i < parsedRCVs.length; i++) {
    for (const cui of parsedRCVs[i].medGenCUIs) {
      rcvByMedGen.set(cui, i);
    }
  }

  // ── Step 3: Parse all SCVs (ClinicalAssertions) ──────────────────────────────
  const caListContent = innerContent(xml, "ClinicalAssertionList") ?? "";
  const caBlocks = findAllBlocks(caListContent, "ClinicalAssertion");
  const parsedSCVs: ParsedSCV[] = caBlocks
    .map((block) => parseClinicalAssertion(block))
    .filter((s): s is ParsedSCV => s !== null);

  // ── Step 4: Group SCVs under their RCV ───────────────────────────────────────
  // submissions[i] holds the SCV list for parsedRCVs[i]
  const submissionsPerRCV: ClinicalSubmission[][] = parsedRCVs.map(() => []);

  for (const scv of parsedSCVs) {
    let rcvIndex: number | undefined;

    // Primary: match by MedGen CUI
    for (const cui of scv.medGenXRefs) {
      if (rcvByMedGen.has(cui)) {
        rcvIndex = rcvByMedGen.get(cui);
        break;
      }
    }

    // Secondary fallback: if only one RCV exists, assign to it
    if (rcvIndex === undefined && parsedRCVs.length === 1) {
      rcvIndex = 0;
    }

    // Determine conditionAsserted from matched RCV
    const conditionAsserted =
      rcvIndex !== undefined
        ? (parsedRCVs[rcvIndex].conditions[0]?.name ?? null)
        : null;

    const submission: ClinicalSubmission = {
      scvAccession: scv.scvAccession,
      significance: scv.significance,
      reviewStatus: scv.reviewStatus,
      submitter: scv.submitter,
      lastEvaluated: scv.lastEvaluated,
      conditionAsserted,
      contributesToAggregate: scv.contributesToAggregate,
    };

    if (rcvIndex !== undefined) {
      submissionsPerRCV[rcvIndex].push(submission);
    }
    // Unmatched SCVs (no MedGen match, >1 RCV) are silently dropped.
    // This affects only old retired OMIM-keyed submissions with no MedGen reference.
    // Documented as a known limitation in PHASE-5.5B-1-FINAL-REPORT.md.
  }

  // ── Step 5: Assemble final ClinicalEvidence ───────────────────────────────────
  const interpretations: ConditionInterpretation[] = parsedRCVs.map((rcv, i) => ({
    rcvAccession: rcv.rcvAccession,
    conditions: rcv.conditions,
    aggregateClassification: rcv.aggregateClassification,
    aggregateReviewStatus: rcv.aggregateReviewStatus,
    lastEvaluated: rcv.lastEvaluated,
    submissionCount: rcv.submissionCount,
    submissions: submissionsPerRCV[i],
  }));

  return {
    clinvarVariationId,
    interpretations,
  };
}
