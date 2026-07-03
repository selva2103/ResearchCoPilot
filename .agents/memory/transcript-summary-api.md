---
name: Transcript Summary API
description: How transcript-level RefSeq summaries are fetched for the Transcript Explorer (Phase 5.3B Part 2)
---

## Rule
Transcript-level summaries require EFetch `db=nuccore&rettype=gb` (GenBank flat file), NOT nuccore ESummary.

**Why:** nuccore ESummary does NOT include a `comment` field for RefSeq records (confirmed 2026-07-03 for NM_000546.6). The `comment` field does not exist in the ESummary response. The summary is only in the GenBank COMMENT section, extracted via EFetch.

## How to apply
- Route: `GET /api/transcript/summary?accession=NM_000546.6`
- Single EFetch call: `efetch.fcgi?db=nuccore&id={accession}&rettype=gb&retmode=text`
- Parse: look for `Transcript Variant:` paragraph in the COMMENT section — this is the transcript-specific text
- Skip: "REVIEWED REFSEQ:" preamble, "Summary:" paragraph (gene-level, shown elsewhere), version notices, "Publication Note:", `##...` blocks
- Return null when no "Transcript Variant:" paragraph found — UI omits section entirely (no empty card)
- Rate limiting: module-level promise chain + GENE_RATE_DELAY_MS (same pattern as download route)

## COMMENT block structure (confirmed for NM_000546.6)
```
COMMENT     REVIEWED REFSEQ: ...   ← skip
            On Feb 13, 2020...     ← skip (version notice)
            Summary: ...           ← skip (gene-level, already shown)
            Transcript Variant:... ← RETURN THIS
            Publication Note: ...  ← skip
            ##Evidence-Data##      ← skip
            ##RefSeq-Attributes##  ← skip
```
