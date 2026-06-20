"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

// Section 1: Research Landscape — will be populated by PubMed API (MeSH terms + topic clustering)
const PLACEHOLDER_LANDSCAPE = [
  "Transcriptomics",
  "Biomarker Discovery",
  "Machine Learning",
];

// Section 2: Emerging Areas — will be populated by PubMed API (trend analysis on recent publications)
const PLACEHOLDER_EMERGING = [
  "Multi-omics integration",
  "AI-assisted biomarker prediction",
  "Single-cell transcriptomics",
];

// Section 3: Research Gaps — will be populated by OpenAI API (gap analysis from literature)
const PLACEHOLDER_GAPS = [
  "Limited South Asian cohorts",
  "Lack of longitudinal validation studies",
  "Insufficient multi-omics datasets",
];

// Section 4: Suggested Projects — will be populated by OpenAI API (project ideation from gaps)
const PLACEHOLDER_PROJECTS = [
  "Multi-omics biomarker prediction model",
  "RNA-Seq meta-analysis pipeline",
  "Machine learning classification system",
];

// Section 5: Dataset Recommendations — will be populated by PubMed/GEO API (dataset search)
const PLACEHOLDER_DATASETS = [
  "GEO GSE12345 — RNA-seq breast cancer data",
  "TCGA-BRCA — Breast cancer cohort",
  "ArrayExpress E-MTAB-5678",
];

export default function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(q);

  const handleSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/results?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div>
      <div className="mb-10">
        <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium mb-1 uppercase tracking-wide">
          Analysis Results
        </p>
        <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-6 leading-snug">
          {q ? (
            <>
              Results for:{" "}
              <span className="text-indigo-600 dark:text-indigo-400">
                &ldquo;{q}&rdquo;
              </span>
            </>
          ) : (
            "No topic provided"
          )}
        </h2>

        <form onSubmit={handleSearch} className="flex gap-3 max-w-2xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search another topic…"
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-6 py-3 text-sm shadow-sm transition-all"
          >
            Analyze
          </button>
        </form>
      </div>

      {q ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          <ResultSection
            icon="🧬"
            title="Research Landscape"
            color="blue"
            items={PLACEHOLDER_LANDSCAPE}
            itemType="topic"
          />
          <ResultSection
            icon="🚀"
            title="Emerging Areas"
            color="purple"
            items={PLACEHOLDER_EMERGING}
            itemType="area"
          />
          <ResultSection
            icon="🔍"
            title="Research Gaps"
            color="indigo"
            items={PLACEHOLDER_GAPS}
            itemType="gap"
          />
          <ResultSection
            icon="💡"
            title="Suggested Projects"
            color="emerald"
            items={PLACEHOLDER_PROJECTS}
            itemType="project"
          />
          <ResultSection
            icon="🗄️"
            title="Dataset Recommendations"
            color="violet"
            items={PLACEHOLDER_DATASETS}
            itemType="dataset"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-6xl mb-4">🔬</div>
          <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
            No topic entered
          </h3>
          <p className="text-slate-500 dark:text-slate-400 mb-6">
            Go back to the homepage and enter a research topic to analyze.
          </p>
          <a
            href="/"
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 text-sm shadow-sm transition-all"
          >
            Go to Homepage
          </a>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  icon,
  title,
  color,
  items,
  itemType,
}: {
  icon: string;
  title: string;
  color: "blue" | "purple" | "indigo" | "emerald" | "violet";
  items: string[];
  itemType: string;
}) {
  const colorMap = {
    blue: {
      header: "bg-blue-600",
      badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
      bullet: "bg-blue-500",
    },
    purple: {
      header: "bg-purple-600",
      badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
      bullet: "bg-purple-500",
    },
    indigo: {
      header: "bg-indigo-600",
      badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
      bullet: "bg-indigo-500",
    },
    emerald: {
      header: "bg-emerald-600",
      badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
      bullet: "bg-emerald-500",
    },
    violet: {
      header: "bg-violet-600",
      badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
      bullet: "bg-violet-500",
    },
  };

  const c = colorMap[color];

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/60 overflow-hidden shadow-sm backdrop-blur-sm">
      <div className={`${c.header} px-5 py-4 flex items-center gap-2`}>
        <span className="text-xl">{icon}</span>
        <h3 className="font-semibold text-white text-base">{title}</h3>
        <span
          className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${c.badge}`}
        >
          {items.length} found
        </span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {items.map((item, i) => (
          <li key={i} className="px-5 py-4 flex gap-3 items-start">
            <span
              className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${c.bullet}`}
            />
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {item}
            </p>
          </li>
        ))}
      </ul>
      <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700/50">
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">
          Placeholder data — connect an AI backend to populate {itemType}s
        </p>
      </div>
    </div>
  );
}
