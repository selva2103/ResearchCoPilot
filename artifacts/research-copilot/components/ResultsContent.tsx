"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

const PLACEHOLDER_GAPS = [
  "Long-term safety profiling of base editing in primary neurons",
  "Role of off-target DSBs in edited stem cell differentiation potential",
  "Population-level variation in CRISPR delivery efficiency",
];

const PLACEHOLDER_DATASETS = [
  { name: "GEO GSE12345", desc: "RNA-seq from CRISPR-edited iPSC neurons", source: "NCBI GEO" },
  { name: "UniProt – Cas9 variants", desc: "Structural and functional annotations", source: "UniProt" },
  { name: "dbSNP off-target loci", desc: "Common SNPs near predicted off-target sites", source: "NCBI dbSNP" },
];

const PLACEHOLDER_IDEAS = [
  "Develop a ML model to predict CRISPR off-target effects using epigenomic features",
  "Systematic comparison of BE3 vs. ABE8e efficiency across 50 neuronal cell lines",
  "Single-cell transcriptomic atlas of CRISPR-corrected Parkinson's patient iPSCs",
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <ResultSection
            icon="🔍"
            title="Research Gaps"
            color="indigo"
            items={PLACEHOLDER_GAPS}
            itemType="gap"
          />
          <ResultSection
            icon="🗄️"
            title="Public Datasets"
            color="violet"
            items={PLACEHOLDER_DATASETS.map((d) => `${d.name} — ${d.desc} (${d.source})`)}
            itemType="dataset"
          />
          <ResultSection
            icon="💡"
            title="Project Ideas"
            color="emerald"
            items={PLACEHOLDER_IDEAS}
            itemType="idea"
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
  color: "indigo" | "violet" | "emerald";
  items: string[];
  itemType: string;
}) {
  const colorMap = {
    indigo: {
      header: "bg-indigo-600",
      badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
      bullet: "bg-indigo-500",
    },
    violet: {
      header: "bg-violet-600",
      badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
      bullet: "bg-violet-500",
    },
    emerald: {
      header: "bg-emerald-600",
      badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
      bullet: "bg-emerald-500",
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
