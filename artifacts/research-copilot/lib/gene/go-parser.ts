/**
 * lib/gene/go-parser.ts — Gene EFetch XML → FunctionalAnnotation[] (Phase 5.6A)
 *
 * AUDIT FINDING (Phase 5.6A, 2026-07-27):
 *   CONFIRMED SUFFICIENT — Gene EFetch XML contains GO annotations via the
 *   GeneOntology section, sourced from GOA. Coverage is comparably complete
 *   to QuickGO across all four audit genes (TP53/BRCA1/CFTR/Trp53 mouse).
 *   No new third-party service introduced; same NCBI EFetch endpoint.
 *
 * XML structure (confirmed from live TP53 Gene EFetch XML, 2026-07-27):
 *   <Gene-commentary_heading>GeneOntology</Gene-commentary_heading>
 *   <Gene-commentary_comment>
 *     <Gene-commentary>
 *       <Gene-commentary_label>Function|Process|Component</Gene-commentary_label>
 *       <Gene-commentary_comment>
 *         <Gene-commentary>
 *           <Gene-commentary_source>
 *             <Other-source>
 *               <Other-source_src>
 *                 <Dbtag>
 *                   <Dbtag_db>GO</Dbtag_db>
 *                   <Dbtag_tag><Object-id><Object-id_id>{numericId}</Object-id_id></Object-id></Dbtag_tag>
 *                 </Dbtag>
 *               </Other-source_src>
 *               <Other-source_anchor>{term name}</Other-source_anchor>
 *               <Other-source_post-text>evidence: {CODE}</Other-source_post-text>
 *             </Other-source>
 *           </Gene-commentary_source>
 *         </Gene-commentary>
 *       </Gene-commentary_comment>
 *     </Gene-commentary>
 *   </Gene-commentary_comment>
 *
 * DEDUPLICATION: The prompt explicitly forbids custom deduplication — preserve each
 *   annotation distinctly. The XML may have multiple entries for the same GO ID
 *   with different evidence codes (e.g. one EXP and one IEA for the same term);
 *   all are kept. Only malformed entries (missing goId or term) are excluded.
 *
 * IDENTIFIER IMMUTABILITY: geneId, geneSymbol, and organism are passed in from the
 *   already-resolved Gene context. This parser never independently re-resolves them.
 */

import type { FunctionalAnnotation } from "@/types/functional-annotation";
import { resolveEvidenceLabel } from "@/types/functional-annotation";

/** XML label → FunctionalAnnotation aspect mapping (as-found in Gene EFetch XML). */
const ASPECT_MAP: Readonly<Record<string, FunctionalAnnotation["aspect"]>> = {
  Function: "molecular_function",
  Process: "biological_process",
  Component: "cellular_component",
};

// ─── Internal regex helpers (same strategy as lib/clinical-evidence/parse.ts) ──

/** Extract the text content of the first occurrence of <tagName>...</tagName>. */
function textOf(xml: string, tagName: string): string | null {
  const m = xml.match(new RegExp(`<${tagName}>([^<]*)<\\/${tagName}>`));
  return m ? m[1].trim() : null;
}

/**
 * Find all non-overlapping blocks wrapped by <tag>...</tag>, where the content
 * may itself contain XML. Uses a greedy-then-trim approach: finds the start tag,
 * then locates the corresponding close tag by tracking nesting depth.
 */
function findAllBlocks(xml: string, tag: string): string[] {
  const results: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(open, pos);
    if (start === -1) break;
    let depth = 1;
    let cur = start + open.length;
    while (cur < xml.length && depth > 0) {
      const nextOpen = xml.indexOf(open, cur);
      const nextClose = xml.indexOf(close, cur);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cur = nextOpen + open.length;
      } else {
        depth--;
        cur = nextClose + close.length;
        if (depth === 0) {
          results.push(xml.slice(start, cur));
          pos = cur;
        }
      }
    }
    if (depth > 0) break; // Malformed XML — stop
  }
  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse GO annotations from a Gene EFetch full XML string.
 *
 * Returns an empty array (never throws) when:
 *   - The XML has no GeneOntology section (gene not annotated in NCBI GOA)
 *   - An individual entry is malformed (missing ID or term name) — excluded silently
 *   - The XML itself is malformed — returns empty array
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
    return parseGoAnnotationsUnsafe(xml, geneId, geneSymbol, organism);
  } catch {
    // XML parse errors must never crash the phase
    return [];
  }
}

function parseGoAnnotationsUnsafe(
  xml: string,
  geneId: string,
  geneSymbol: string,
  organism: string,
): FunctionalAnnotation[] {
  // ── Find the GeneOntology top-level section ─────────────────────────────────
  // The section is a Gene-commentary block with heading "GeneOntology".
  // We locate it by finding the heading, then extract the surrounding commentary.
  const goHeadingIdx = xml.indexOf("<Gene-commentary_heading>GeneOntology</Gene-commentary_heading>");
  if (goHeadingIdx === -1) return [];

  // Walk back to find the opening <Gene-commentary> that contains this heading.
  const commentaryOpen = "<Gene-commentary>";
  const searchBackward = xml.lastIndexOf(commentaryOpen, goHeadingIdx);
  if (searchBackward === -1) return [];

  // Extract from there; findAllBlocks will grab the outer commentary.
  const xmlFromStart = xml.slice(searchBackward);
  const outerBlocks = findAllBlocks(xmlFromStart, "Gene-commentary");
  if (outerBlocks.length === 0) return [];
  const goSection = outerBlocks[0];

  // ── Find aspect sub-sections (Function / Process / Component) ──────────────
  // Each aspect is a Gene-commentary with a Gene-commentary_label child.
  const aspectCommentaries = findAllBlocks(goSection, "Gene-commentary");
  // Skip the first one (it's the outer GeneOntology commentary itself)
  const aspectBlocks = aspectCommentaries.slice(1);

  const annotations: FunctionalAnnotation[] = [];

  for (const aspectBlock of aspectBlocks) {
    const label = textOf(aspectBlock, "Gene-commentary_label");
    if (!label) continue;
    const aspect = ASPECT_MAP[label];
    if (!aspect) continue; // Unknown aspect label — skip

    // ── Individual annotation entries within this aspect ─────────────────────
    // Each entry is a Gene-commentary inside the aspect's Gene-commentary_comment.
    const commentSection = aspectBlock.match(
      /<Gene-commentary_comment>([\s\S]*)<\/Gene-commentary_comment>/
    );
    if (!commentSection) continue;
    const entriesXml = commentSection[1];

    const entryBlocks = findAllBlocks(entriesXml, "Gene-commentary");

    for (const entryBlock of entryBlocks) {
      // Extract the Dbtag block for the GO numeric ID
      const dbtag = entryBlock.match(
        /<Dbtag_db>GO<\/Dbtag_db>\s*<Dbtag_tag>\s*<Object-id>\s*<Object-id_id>(\d+)<\/Object-id_id>/
      );
      if (!dbtag) continue;

      const numericId = dbtag[1];
      // Format as GO:XXXXXXX (7-digit zero-padded)
      const goId = `GO:${numericId.padStart(7, "0")}`;

      // Extract term name from Other-source_anchor
      const anchorMatch = entryBlock.match(/<Other-source_anchor>([^<]+)<\/Other-source_anchor>/);
      if (!anchorMatch) continue;
      const term = anchorMatch[1].trim();
      if (!term) continue;

      // Extract evidence code from Other-source_post-text "evidence: CODE"
      const evidenceMatch = entryBlock.match(/<Other-source_post-text>evidence:\s*([^\s<]+)<\/Other-source_post-text>/);
      const evidenceCode = evidenceMatch ? evidenceMatch[1].trim() : "ND";

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
