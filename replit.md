# ResearchCoPilot

A Next.js 15 TypeScript application that helps life science researchers discover research gaps, find public datasets, and generate project ideas.

## Run & Operate

- `pnpm --filter @workspace/research-copilot run dev` — run the Next.js frontend (port 20891)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string (for api-server only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: **Next.js 15** (App Router), React 19, Tailwind CSS v4
- API: Express 5 (shared `api-server` artifact)
- DB: PostgreSQL + Drizzle ORM (not yet wired up)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/research-copilot/` — Next.js 15 frontend
  - `app/` — App Router pages and layouts
  - `components/` — Shared React components
  - `lib/` — Utility functions
- `artifacts/api-server/` — Shared Express API server
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/` — Drizzle ORM schema

## Architecture decisions

- Next.js App Router used (not Pages Router) — server components by default, `"use client"` for interactive forms.
- Tailwind CSS v4 with `@tailwindcss/postcss` plugin (PostCSS-based, not Vite plugin).
- Results page uses `Suspense` boundary with `useSearchParams` inside a client component to support streaming.
- The artifact is registered as `kind = "web"` at `previewPath = "/"` — production uses `next start` (not static export).
- No auth, payments, or database yet — clean starter only.

## Product

- **Homepage** (`/`): Large hero with search input and "Analyze Topic" CTA, plus three feature cards.
- **Results** (`/results?q=...`): Displays research gaps, public datasets, and project ideas for a given topic. Currently shows placeholder data; connect an AI backend to populate real results.

## User preferences

- Uses Next.js 15 (App Router) with TypeScript — not React+Vite.
- Tailwind CSS v4 via PostCSS (not the Vite plugin).

## Gotchas

- Next.js version pinned to `15.2.9` — newer patch versions (15.3.x) were blocked by the workspace package firewall's `minimumReleaseAge` policy at time of setup.
- The `next` binary is in `artifacts/research-copilot/node_modules/.bin/` — `pnpm run dev` picks it up automatically via the package script.
- `PORT` env var is injected by the workflow (`artifact.toml` → `[services.env]`); the dev script passes it to `next dev -p $PORT`.
- Do NOT add `next` to the pnpm workspace catalog — it conflicts with Vite-based artifacts.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
