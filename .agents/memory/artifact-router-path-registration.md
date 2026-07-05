---
name: Artifact path-router registration for new API routes
description: New Next.js API routes return 404 through the public/preview domain even though they work on localhost, unless registered in artifact.toml's paths list.
---

When `router = "path"` in an artifact's `.replit-artifact/artifact.toml`, the
`[[services]] paths = [...]` list is an explicit allow-list the platform proxy
uses to decide which service handles a given URL. Any path not listed there —
even a normal Next.js `app/api/**/route.ts` that works fine when curled
directly against the app's own port — falls through to whichever *other*
artifact's path claim is broader (e.g. a sibling API-server artifact claiming
the generic `/api` prefix). That sibling then returns its own framework's
default 404 (e.g. Express's `Cannot GET ...`), which looks identical to a
routing bug in application code but isn't one.

**Why:** Diagnosed for ResearchCoPilot's Transcript Explorer — `/api/transcript/download`
and `/api/transcript/summary` returned 200 on `localhost:<port>` but 404 (with
`x-powered-by: Express`) through the public dev domain, because they were
missing from `artifact.toml`'s `paths` array while a separate bare Express
`api-server` artifact claimed `/api` broadly and had no matching route.

**How to apply:** When a new API route under a Next.js (or similar) artifact
returns 404 only through the public/preview domain (not on the app's own
localhost port), check `artifacts/<name>/.replit-artifact/artifact.toml` for
a `paths` list before assuming the route code itself is broken. `artifact.toml`
cannot be edited directly — write the updated TOML to a sibling
`artifact.edit.toml` file and call `verifyAndReplaceArtifactToml` (exposed as
a callback in the `code_execution` sandbox) to apply it, then restart the
artifact's workflow.
