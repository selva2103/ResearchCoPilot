---
name: Artifact path-router registration
description: Every Next.js API route in research-copilot must be listed in artifact.toml paths or the path router sends browser requests to the api-server (which claims /api broadly).
---

# Artifact Path-Router Registration

## The Rule

Every Next.js API route in `artifacts/research-copilot` must be explicitly listed in:
`artifacts/research-copilot/.replit-artifact/artifact.toml` under `services[web].paths`

Example:
```toml
paths = ["/", "/api/analyze", "/api/variant/list", ...]
```

## Why

The Replit path router uses `artifact.toml` paths lists to route incoming requests to the correct service. The `api-server` artifact claims the broad prefix `paths = ["/api"]`. Research-copilot's paths list is more specific, so any `/api/*` route NOT listed there gets routed to the api-server instead of the Next.js app — producing a 404.

## How to Apply

When adding any new route like `app/api/foo/bar/route.ts` to research-copilot, also add `/api/foo/bar` to the paths list in the artifact.toml. This must be done before the route will work in the browser.

## False Positive Risk

Smoke tests that call `localhost:{PORT}` directly (e.g. `curl http://localhost:5000/api/foo/bar`) bypass the path router entirely and will pass even when the route is NOT registered. Tests must use the proxied public URL to exercise the full router stack, or registration gaps will go undetected until a real browser request exposes them.

This gap caused the Phase 5.5A fix session: `/api/variant/list` was omitted from the paths list, and all `curl localhost:5000` smoke tests passed while the browser UI showed 404.

## Current paths list (as of Phase 5.5A fix session)

```
"/", "/api/analyze", "/api/pubmed-test", "/api/transcript/download",
"/api/transcript/summary", "/api/protein/summaries", "/api/protein/detail",
"/api/protein/download", "/api/protein/research-context", "/api/variant/list"
```
