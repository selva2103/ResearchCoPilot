import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResearchCoPilot",
  description:
    "Discover Research Gaps, Find Datasets, Generate Project Ideas for life science researchers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
        <nav className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <a
              href="/"
              className="flex items-center gap-2 font-bold text-lg text-slate-900 dark:text-white"
            >
              <span className="text-2xl">🔬</span>
              <span>ResearchCoPilot</span>
            </a>
            <div className="flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
              <a
                href="/"
                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                Home
              </a>
              <a
                href="/results"
                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                Explore
              </a>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
