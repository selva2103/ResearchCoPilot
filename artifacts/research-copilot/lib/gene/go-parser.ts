/**
 * lib/gene/go-parser.ts — Gene EFetch XML → FunctionalAnnotation[] (Phase 5.6A)
 *
 * AUDIT FINDING (Phase 5.6A, 2026-07-27):
 *   CONFIRMED SUFFICIENT — Gene EFetch XML contains GO annotations via the
 *   GeneOntology section, sourced from GOA. Coverage is comparably complete
 *   to QuickGO across all four audit genes (TP53/BRCA1/CFTR/Trp53 mouse).
 *   No new third-party service introduced; same NCBI EFetch endpoint.
 *
 * XML structure (confirmed from live Gene EFetch XML, 2026-07-27):
 *   Position ~950K in TP53 (34MB total) — NOT at the document root.
 *
 *   <Gene-commentary>
 *     <Gene-commentary_type value="comment">254</Gene-commentary_type>
 *     <Gene-commentary_heading>GeneOntology</Gene-commentary_heading>
 *     ...
 *     <Gene-commentary_comment>
 *       <Gene-commentary>
 *         <Gene-commentary_label>Function|Process|Component</Gene-commentary_label>
 *         <Gene-commentary_comment>
 *           <Gene-commentary>
 *             <Gene-commentary_source>
 *               <Other-source>
 *                 <Other-source_src>
 *                   <Dbtag><Dbtag_db>GO</Dbtag_db>
 *                     <Dbtag_tag><Object-id>
 *                       <Object-id_id>{numericId}</Object-id_id>
 *                     </Object-id></Dbtag_tag>
 *                   </Dbtag>
 *                 </Other-source_src>
 *                 <Other-source_anchor>{term name}</Other-source_anchor>
 *                 <Other-source_post-text>evidence: {CODE}</Other-source_post-text>
 *               </Other-source>
 *             </Gene-commentary_source>
 *           </Gene-commentary>
 *         </Gene-commentary_comment>
 *       </Gene-commentary>
 *     </Gene-commentary_comment>
 *
 * PARSING STRATEGY:
 *   The Gene EFetch XML can be 30MB+ (TP53 = 34MB) with 17,000+ Gene-commentary
 *   elements. Rather than general-purpose XML parsing or recursive block-finding,
 *   we use a direct string-slice + targeted regex approach:
 *     1. Locate the GeneOntology section by heading string position
 *     2. Find section end (next Gene-commentary_heading to avoid cross-section bleed)
 *     3. Split by aspect labels (Function / Process / Component)
 *     4. Within each aspect slice, extract GO entries with a single regex
 *   This is O(n) in section length rather than O(n) in total XML length.
 *
 * DEDUPLICATION:
 *   All entries preserved — same GO ID with different evidence codes kept separately.
 *   No custom deduplication; only malformed entries (missing goId or term) skipped.
 *
 * IDENTIFIER IMMUTABILITY:
 *   geneId, geneSymbol, organism passed in from already-resolved Gene context.
 *   Never re-derived here.
 */

import type { FunctionalAnnotation } from "@/types/functional-annotation";
import { resolveEvidenceLabel } from "@/types/functional-annotation";

/** XML label in Gene EFetch → FunctionalAnnotation aspect */
const ASPECT_MAP: Readonly<Record<string, FunctionalAnnotation["aspect"]>> = {
  Function: "molecular_function",
  Process: "biological_process",
  Component: "cellular_component",
};

// ─── GO entry extraction regex ────────────────────────────────────────────────
// Matches one GO annotation entry block within an aspect section.
// Groups: (1) numeric GO ID, (2) term name, (3) evidence code.
// The regex operates on small aspect slices (~10–100KB), NOT the full 34MB XML.
const GO_ENTRY_RE =
  /<Object-id_id>(\d+)<\/Object-id_id>[\s\S]*?<Other-source_anchor>([^<]+)<\/Other-source_anchor>[\s\S]*?<Other-source_post-text>evidence:\s*(\S+)<\/Other-source_post-text>/g;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse GO annotations from a Gene EFetch full XML string.
 *
 * Returns an empty array (never throws) when:
 *   - The XML has no GeneOntology section (gene not annotated in NCBI GOA)
 *   - An individual entry is malformed — excluded silently
 *   - The XML is malformed — returns empty array
 *
 * @param xml         Raw Gene EFetch XML string (db=gene, rettype=xml)
 * @param geneId      Already-resolved NCBI Gene ID — NOT re-derived here
 * @param geneSymbol  Already-resolved gene symbol — display only
 * @param organism    Already-resolved organism scientific name — display only
 */
export function parseGoAnnotations(
  xml: string,
  geneId: string,
  geneSymbol: string,
  organism: string,
): FunctionalAnnotation[] {
  try {
    return parseGoAnnotationsInternal(xml, geneId, geneSymbol, organism);
  } catch {
    return [];
  }
}

function parseGoAnnotationsInternal(
  xml: string,
  geneId: string,
  geneSymbol: string,
  organism: string,
): FunctionalAnnotation[] {
  // ── Step 1: Locate the GeneOntology section ─────────────────────────────────
  const GO_HEADING = "<Gene-commentary_heading>GeneOntology</Gene-commentary_heading>";
  const goHeadingIdx = xml.indexOf(GO_HEADING);
  if (goHeadingIdx === -1) return [];

  // ── Step 2: Find section end — the NEXT Gene-commentary_heading after this one
  // This prevents aspect-label matches from bleeding into adjacent sections.
  const HEADING_OPEN = "<Gene-commentary_heading>";
  const nextHeadingIdx = xml.indexOf(HEADING_OPEN, goHeadingIdx + GO_HEADING.length);

  // Extract just the GeneOntology section (may still be 100–500KB for large genes)
  const goSection =
    nextHeadingIdx !== -1
      ? xml.slice(goHeadingIdx, nextHeadingIdx)
      : xml.slice(goHeadingIdx);

  // ── Step 3: Find aspect sub-sections by label positions ──────────────────────
  // Each aspect is delimited by its <Gene-commentary_label> tag.
  // We find the positions of all three aspect labels within goSection,
  // then slice the text between consecutive labels to get each aspect's content.

  interface AspectBoundary {
    aspect: FunctionalAnnotation["aspect"];
    startIdx: number;  // position of the label tag in goSection
    endIdx: number;    // exclusive end (start of next aspect, or end of section)
  }

  const LABEL_TAG_OPEN = "<Gene-commentary_label>";
  const LABEL_TAG_CLOSE = "</Gene-commentary_label>";

  const aspectBoundaries: AspectBoundary[] = [];
  let searchPos = 0;

  while (searchPos < goSection.length) {
    const labelStart = goSection.indexOf(LABEL_TAG_OPEN, searchPos);
    if (labelStart === -1) break;

    const labelEnd = goSection.indexOf(LABEL_TAG_CLOSE, labelStart);
    if (labelEnd === -1) break;

    const labelText = goSection.slice(labelStart + LABEL_TAG_OPEN.length, labelEnd);
    const aspect = ASPECT_MAP[labelText];

    if (aspect) {
      aspectBoundaries.push({ aspect, startIdx: labelStart, endIdx: goSection.length });
      // Update previous entry's endIdx to this label's start
      if (aspectBoundaries.length >= 2) {
        aspectBoundaries[aspectBoundaries.length - 2].endIdx = labelStart;
      }
    }

    searchPos = labelEnd + LABEL_TAG_CLOSE.length;
  }

  if (aspectBoundaries.length === 0) return [];

  // ── Step 4: Extract GO entries from each aspect slice ────────────────────────
  const annotations: FunctionalAnnotation[] = [];

  for (const { aspect, startIdx, endIdx } of aspectBoundaries) {
    const aspectSlice = goSection.slice(startIdx, endIdx);

    // Reset the regex lastIndex before each use (global regex is stateful)
    GO_ENTRY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = GO_ENTRY_RE.exec(aspectSlice)) !== null) {
      const numericId = match[1];
      const term = match[2].trim();
      const evidenceCode = match[3].trim();

      if (!numericId || !term) continue;

      const goId = `GO:${numericId.padStart(7, "0")}`;

      annotations.push({
        goId,
        term,
        aspect,
        evidenceCode,
        evidenceLabel: resolveEvidenceLabel(evidenceCode),
        source: "ncbi-gene-xml",
        geneId,
        geneSymbol,
        organism,
      });
    }
  }

  return annotations;
}
