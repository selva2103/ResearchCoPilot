import { Suspense } from "react";
import ResultsContent from "@/components/ResultsContent";

export default function ResultsPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <Suspense fallback={<ResultsSkeleton />}>
        <ResultsContent />
      </Suspense>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-lg w-2/3 mb-4" />
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-12" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-48 bg-slate-200 dark:bg-slate-700 rounded-2xl"
          />
        ))}
      </div>
    </div>
  );
}
