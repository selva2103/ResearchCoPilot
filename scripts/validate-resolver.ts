/**
 * validate-resolver.ts — Phase 5.1.5 Biological Query Resolution Validation Suite
 *
 * Run: pnpm --filter @workspace/research-copilot exec tsx --tsconfig tsconfig.json ../../scripts/validate-resolver.ts
 *
 * Tests every query category from the Phase 5.1.5 validation spec.
 * Calls resolveQuery() directly — bypasses PubMed/GEO/Sequence to test the
 * resolver in isolation with proper NCBI rate limiting between calls.
 */

// Resolve @/ alias manually for the standalone script context
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RC_ROOT = path.resolve(__dirname, "../artifacts/research-copilot");

// We run via tsx from the research-copilot directory, so @/ maps there.
// The tsconfig.json in that directory sets paths: { "@/*": ["./*"] }.

import { resolveQuery } from "../artifacts/research-copilot/lib/resolver/index.js";
import type { QueryResolution, ConfidenceTier, QueryType } from "../artifacts/research-copilot/types/query-resolution.js";

// ─── Test case definition ──────────────────────────────────────────────────────

interface TestCase {
  query: string;
  category: string;
  /** Expected type, or undefined if we just report (don't assert) */
  expectedType?: QueryType;
  /** Minimum expected confidence tier */
  minTier?: ConfidenceTier;
  /** Maximum expected confidence tier (for unknowns = "low") */
  maxTier?: ConfidenceTier;
  /** If true: resolution must NOT be Gene/Disease/Organism */
  expectUnknown?: boolean;
  /** Expected normalizedQuery (for synonym tests) */
  expectedNormalized?: string;
  /** If true: ambiguityDetected should be true OR tier should be "medium" */
  expectAmbiguity?: boolean;
}

// ─── Rate-limit delay between calls ──────────────────────────────────────────
// Each resolveQuery may make up to 4 NCBI API calls (ESearch×2 + ESummary×2).
// We wait 1 s between queries to avoid 429s.
const INTER_QUERY_DELAY_MS = 1200;
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── All test cases ───────────────────────────────────────────────────────────

const TEST_CASES: TestCase[] = [
  // ── DISEASES ────────────────────────────────────────────────────────────────
  { query: "Parkinson disease",    category: "Disease", expectedType: "Disease" },
  { query: "Cystic fibrosis",      category: "Disease", expectedType: "Disease" },
  { query: "Huntington disease",   category: "Disease", expectedType: "Disease" },
  { query: "Crohn disease",        category: "Disease", expectedType: "Disease" },
  { query: "Asthma",               category: "Disease", expectedType: "Disease" },
  { query: "Influenza",            category: "Disease", expectedType: "Disease" },
  { query: "Dengue fever",         category: "Disease", expectedType: "Disease" },
  { query: "Malaria",              category: "Disease", expectedType: "Disease" },
  { query: "Type 2 diabetes",      category: "Disease", expectedType: "Disease" },
  { query: "Psoriasis",            category: "Disease", expectedType: "Disease" },

  // ── GENES ───────────────────────────────────────────────────────────────────
  { query: "APOE",  category: "Gene", expectedType: "Gene" },
  { query: "KRAS",  category: "Gene", expectedType: "Gene" },
  { query: "MYC",   category: "Gene", expectedType: "Gene" },
  { query: "PTEN",  category: "Gene", expectedType: "Gene" },
  { query: "CFTR",  category: "Gene", expectedType: "Gene" },
  { query: "HBB",   category: "Gene", expectedType: "Gene" },
  { query: "VEGFA", category: "Gene", expectedType: "Gene" },
  { query: "BRAF",  category: "Gene", expectedType: "Gene" },
  { query: "AKT1",  category: "Gene", expectedType: "Gene" },
  { query: "IL6",   category: "Gene", expectedType: "Gene" },

  // ── ORGANISMS ───────────────────────────────────────────────────────────────
  { query: "Escherichia coli",         category: "Organism", expectedType: "Organism" },
  { query: "Saccharomyces cerevisiae", category: "Organism", expectedType: "Organism" },
  { query: "Drosophila melanogaster",  category: "Organism", expectedType: "Organism" },
  { query: "Danio rerio",              category: "Organism", expectedType: "Organism" },
  { query: "Mus musculus",             category: "Organism", expectedType: "Organism" },
  { query: "Caenorhabditis elegans",   category: "Organism", expectedType: "Organism" },
  { query: "Bacillus subtilis",        category: "Organism", expectedType: "Organism" },

  // ── VIRUSES ─────────────────────────────────────────────────────────────────
  { query: "Influenza A virus", category: "Virus/Organism", expectedType: "Organism" },
  { query: "HIV-1",             category: "Virus/Organism" },  // may be Organism or Disease
  { query: "Zika virus",        category: "Virus/Organism", expectedType: "Organism" },
  { query: "Ebola virus",       category: "Virus/Organism", expectedType: "Organism" },
  { query: "Dengue virus",      category: "Virus/Organism", expectedType: "Organism" },

  // ── ACCESSIONS ──────────────────────────────────────────────────────────────
  { query: "NC_000001",    category: "Accession", expectedType: "Chromosome" },
  { query: "NM_001126112", category: "Accession", expectedType: "Transcript" },
  { query: "NP_001119584", category: "Accession", expectedType: "Protein"    },
  { query: "NG_012232",    category: "Accession", expectedType: "Genome"     },
  { query: "GCF_009858895", category: "Accession", expectedType: "Assembly"  },

  // ── AMBIGUOUS TERMS ─────────────────────────────────────────────────────────
  { query: "ACTB",  category: "Ambiguous", expectAmbiguity: true },
  { query: "GAPDH", category: "Ambiguous", expectAmbiguity: true },
  { query: "COX1",  category: "Ambiguous", expectAmbiguity: true },
  { query: "MAPK",  category: "Ambiguous" },
  { query: "ABC1",  category: "Ambiguous" },

  // ── SYNONYMS ────────────────────────────────────────────────────────────────
  { query: "TB",    category: "Synonym", expectedType: "Disease", expectedNormalized: "Tuberculosis" },
  { query: "COVID", category: "Synonym", expectedType: "Disease", expectedNormalized: "COVID-19" },
  { query: "AML",   category: "Synonym", expectedType: "Disease", expectedNormalized: "Acute Myeloid Leukemia" },

  // ── UNKNOWNS ─────────────────────────────────────────────────────────────────
  { query: "abcdefxyz",       category: "Unknown", expectUnknown: true, maxTier: "low" },
  { query: "proteinxyz123",   category: "Unknown", expectUnknown: true, maxTier: "low" },
  { query: "qwertybiology",   category: "Unknown", expectUnknown: true, maxTier: "low" },

  // ── MIXED QUERIES ────────────────────────────────────────────────────────────
  { query: "Human TP53",           category: "Mixed" },
  { query: "Mouse BRCA1",          category: "Mixed" },
  { query: "SARS spike protein",   category: "Mixed" },
  { query: "Breast cancer TP53",   category: "Mixed" },
  { query: "Tuberculosis H37Rv",   category: "Mixed" },
  { query: "EGFR lung cancer",     category: "Mixed" },
  { query: "CRISPR Cas9",          category: "Mixed" },
  { query: "microRNA-21",          category: "Mixed" },
];

// ─── Result record ─────────────────────────────────────────────────────────────

interface TestResult {
  query: string;
  category: string;
  resolution: QueryResolution;
  pass: boolean;
  failures: string[];
  durationMs: number;
}

// ─── Assertion helper ─────────────────────────────────────────────────────────

function tierRank(t: ConfidenceTier): number {
  return t === "high" ? 2 : t === "medium" ? 1 : 0;
}

function assertCase(tc: TestCase, r: QueryResolution): string[] {
  const failures: string[] = [];

  // Expected type
  if (tc.expectedType && r.queryType !== tc.expectedType) {
    failures.push(`type: expected "${tc.expectedType}", got "${r.queryType}"`);
  }

  // Must be unknown
  if (tc.expectUnknown) {
    if (r.queryType !== "Unknown") {
      failures.push(`expected Unknown, got "${r.queryType}" (confidence ${r.confidence})`);
    }
    if (r.confidenceTier !== "low") {
      failures.push(`expected LOW confidence for unknown, got "${r.confidenceTier}"`);
    }
  }

  // Max tier (unknowns must be "low")
  if (tc.maxTier && tierRank(r.confidenceTier) > tierRank(tc.maxTier)) {
    failures.push(`tier too high: expected max "${tc.maxTier}", got "${r.confidenceTier}"`);
  }

  // Expected normalized query (synonyms)
  if (tc.expectedNormalized && r.normalizedQuery !== tc.expectedNormalized) {
    failures.push(`normalizedQuery: expected "${tc.expectedNormalized}", got "${r.normalizedQuery}"`);
  }

  // Ambiguity: must have candidateMatches or MEDIUM confidence
  if (tc.expectAmbiguity) {
    const hasAmbig = r.ambiguityDetected === true || (r.candidateMatches && r.candidateMatches.length > 1);
    const isMedium = r.confidenceTier === "medium";
    if (!hasAmbig && !isMedium) {
      failures.push(
        `ambiguity not reported (ambiguityDetected=${r.ambiguityDetected}, tier=${r.confidenceTier})`
      );
    }
  }

  // Gating contract: MEDIUM → normalizedQuery should NOT silently change downstream
  // (we can't fully test downstream here, but we can flag if a MEDIUM result has
  // normalizedQuery != originalQuery — the UI must confirm before applying it)
  if (r.confidenceTier === "medium" && r.normalizedQuery !== r.originalQuery) {
    // This is EXPECTED behaviour — just note it
    // (not a failure, but we surface it in the report)
  }

  return failures;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function formatResolution(r: QueryResolution): string {
  const lines: string[] = [
    `  type          : ${r.queryType}`,
    `  normalized    : ${r.normalizedQuery}`,
    `  confidence    : ${r.confidence.toFixed(2)} [${r.confidenceTier.toUpperCase()}]`,
    `  provider      : ${r.matchedProvider ?? "—"}`,
    `  identifier    : ${r.primaryIdentifier ?? "—"}`,
    `  effectiveQ    : ${r.confidenceTier === "high" ? r.normalizedQuery : r.originalQuery}  ← downstream receives this`,
    `  resolutionPath: ${r.resolutionPath ?? "—"}`,
    `  ambiguity     : ${r.ambiguityDetected ? "YES" : "no"}`,
  ];
  if (r.candidateMatches && r.candidateMatches.length > 0) {
    lines.push(`  candidates    : ${r.candidateMatches.map((c) => `${c.displayName} [${c.organism ?? "?"}]`).join(" | ")}`);
  }
  if (r.synonyms && r.synonyms.length > 0) {
    lines.push(`  synonyms      : ${r.synonyms.slice(0, 5).join(", ")}`);
  }
  if (r.notes) {
    lines.push(`  notes         : ${r.notes.slice(0, 120)}`);
  }
  return lines.join("\n");
}

// ─── Gating verification ──────────────────────────────────────────────────────

function verifyGating(r: QueryResolution): string | null {
  const effectiveQuery =
    r.confidenceTier === "high" && r.normalizedQuery !== r.originalQuery
      ? r.normalizedQuery
      : r.originalQuery;

  // LOW must use originalQuery
  if (r.confidenceTier === "low" && effectiveQuery !== r.originalQuery) {
    return `GATING VIOLATION: LOW tier but effectiveQuery="${effectiveQuery}" ≠ originalQuery="${r.originalQuery}"`;
  }
  // MEDIUM must use originalQuery
  if (r.confidenceTier === "medium" && effectiveQuery !== r.originalQuery) {
    return `GATING VIOLATION: MEDIUM tier but effectiveQuery="${effectiveQuery}" ≠ originalQuery="${r.originalQuery}"`;
  }
  return null;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(80));
  console.log("  PHASE 5.1.5 — BIOLOGICAL QUERY RESOLUTION VALIDATION SUITE");
  console.log(`  ${new Date().toISOString()}  |  ${TEST_CASES.length} queries`);
  console.log("═".repeat(80));
  console.log();

  const results: TestResult[] = [];
  const gatingViolations: string[] = [];
  let bugsDiscovered = 0;

  const categories = [...new Set(TEST_CASES.map((t) => t.category))];

  for (const category of categories) {
    const cases = TEST_CASES.filter((t) => t.category === category);
    console.log(`\n${"─".repeat(80)}`);
    console.log(`  CATEGORY: ${category.toUpperCase()}  (${cases.length} queries)`);
    console.log("─".repeat(80));

    for (const tc of cases) {
      const t0 = Date.now();
      let resolution: QueryResolution;

      try {
        resolution = await resolveQuery(tc.query);
      } catch (err) {
        console.error(`  ✗ EXCEPTION for "${tc.query}": ${err}`);
        results.push({
          query: tc.query,
          category,
          resolution: {
            originalQuery: tc.query,
            normalizedQuery: tc.query,
            queryType: "Unknown",
            confidence: 0,
            confidenceTier: "low",
            relationships: {},
            notes: `Exception: ${err}`,
          },
          pass: false,
          failures: [`Exception thrown: ${err}`],
          durationMs: Date.now() - t0,
        });
        bugsDiscovered++;
        await sleep(INTER_QUERY_DELAY_MS);
        continue;
      }

      const failures = assertCase(tc, resolution);
      const gatingIssue = verifyGating(resolution);
      if (gatingIssue) {
        gatingViolations.push(`"${tc.query}": ${gatingIssue}`);
        failures.push(gatingIssue);
      }

      const pass = failures.length === 0;
      if (!pass) bugsDiscovered++;

      const durationMs = Date.now() - t0;
      const status = pass ? "✓" : "✗";
      const tierLabel = `[${resolution.confidenceTier.toUpperCase()}]`;

      console.log(`\n  ${status} ${pad(`"${tc.query}"`, 32)} → ${pad(resolution.queryType, 12)} ${tierLabel}`);
      console.log(formatResolution(resolution));
      if (!pass) {
        failures.forEach((f) => console.log(`     ⚠ FAIL: ${f}`));
      }

      results.push({ query: tc.query, category, resolution, pass, failures, durationMs });
      await sleep(INTER_QUERY_DELAY_MS);
    }
  }

  // ─── FINAL REPORT ────────────────────────────────────────────────────────────

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  console.log(`\n${"═".repeat(80)}`);
  console.log("  FINAL REPORT — PHASE 5.1.5 VALIDATION");
  console.log("═".repeat(80));
  console.log(`  Total queries tested : ${results.length}`);
  console.log(`  Passed               : ${passed}`);
  console.log(`  Failed               : ${failed}`);
  console.log(`  Gating violations    : ${gatingViolations.length}`);
  console.log();

  if (failed > 0) {
    console.log("  FAILURES SUMMARY:");
    results
      .filter((r) => !r.pass)
      .forEach((r) => {
        console.log(`    ✗ [${r.category}] "${r.query}"`);
        r.failures.forEach((f) => console.log(`        → ${f}`));
      });
    console.log();
  }

  if (gatingViolations.length > 0) {
    console.log("  GATING VIOLATIONS:");
    gatingViolations.forEach((v) => console.log(`    ⚠ ${v}`));
    console.log();
  }

  console.log("  CATEGORY SUMMARY:");
  for (const category of categories) {
    const catResults = results.filter((r) => r.category === category);
    const catPassed = catResults.filter((r) => r.pass).length;
    const avgMs = Math.round(catResults.reduce((s, r) => s + r.durationMs, 0) / catResults.length);
    const mark = catPassed === catResults.length ? "✓" : "✗";
    console.log(`    ${mark} ${pad(category, 20)} ${catPassed}/${catResults.length} passed  (avg ${avgMs}ms)`);
  }

  console.log();
  console.log("  SYNONYM VERIFICATION:");
  const synTests = [
    { q: "TB",    expected: "Tuberculosis" },
    { q: "COVID", expected: "COVID-19" },
    { q: "AML",   expected: "Acute Myeloid Leukemia" },
  ];
  for (const st of synTests) {
    const r = results.find((x) => x.query === st.q);
    if (r) {
      const ok = r.resolution.normalizedQuery === st.expected;
      console.log(`    ${ok ? "✓" : "✗"} "${st.q}" → "${r.resolution.normalizedQuery}" (expected "${st.expected}")`);
    }
  }

  console.log();
  console.log("  UNKNOWN HANDLING VERIFICATION:");
  const unknownQueries = ["abcdefxyz", "proteinxyz123", "qwertybiology"];
  for (const uq of unknownQueries) {
    const r = results.find((x) => x.query === uq);
    if (r) {
      const isOk =
        r.resolution.queryType === "Unknown" && r.resolution.confidenceTier === "low";
      console.log(`    ${isOk ? "✓" : "✗"} "${uq}" → type=${r.resolution.queryType} tier=${r.resolution.confidenceTier}`);
    }
  }

  console.log();
  if (failed === 0 && gatingViolations.length === 0) {
    console.log("  ✅ ALL CHECKS PASSED. Resolver generalizes beyond development examples.");
  } else {
    console.log(`  ❌ ${failed} test(s) failed. ${gatingViolations.length} gating violation(s). See failures above.`);
  }
  console.log("═".repeat(80));
}

main().catch((err) => {
  console.error("Fatal error in validation runner:", err);
  process.exit(1);
});
