import SearchForm from "@/components/SearchForm";

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 py-20">
      <div className="text-center max-w-3xl mx-auto">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-4 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
          <span>✨</span>
          <span>AI-Powered Life Science Research Assistant</span>
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-6 leading-tight">
          Research
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">
            CoPilot
          </span>
        </h1>

        <p className="text-xl sm:text-2xl text-slate-600 dark:text-slate-400 mb-12 leading-relaxed">
          Discover Research Gaps, Find Datasets,
          <br className="hidden sm:block" /> Generate Project Ideas
        </p>

        <SearchForm />

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <FeatureCard
            icon="🔍"
            title="Research Gaps"
            description="Identify unexplored areas and open questions in your field of interest."
          />
          <FeatureCard
            icon="🗄️"
            title="Public Datasets"
            description="Find curated public datasets from NCBI, GEO, UniProt, and more."
          />
          <FeatureCard
            icon="💡"
            title="Project Ideas"
            description="Generate novel, actionable research project ideas ready to pursue."
          />
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-white/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-6 backdrop-blur-sm hover:shadow-lg hover:border-indigo-200 dark:hover:border-indigo-800 transition-all">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
        {description}
      </p>
    </div>
  );
}
