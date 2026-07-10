---
name: Audit Fixes
description: Decisions made when applying the EngineeringOS technical audit findings
---

## Graph entity identity — dual-map approach
Entity persistence in `POST /projects/:id/scan` uses two maps:
- **Primary** `type::path::name → id` — dedup across files (no cross-file collision)
- **Secondary** `type::name → [ids]` (multi-value, first-in wins) — stable relationship resolution

**Why:** Storing the last ID for a given type::name caused relationships to bind to wrong nodes after re-scans that encounter same-named entities in different files. Using an array and always resolving to `ids[0]` keeps binding stable.

**How to apply:** Any future graph persistence code must use the same dual-map pattern. Never use a plain Map with type::name key for dedup.

## Rate limiting behind Replit proxy
`app.set("trust proxy", 1)` is set before rate-limit middleware in `app.ts`.

**Why:** Without this, all requests appear to come from the proxy IP, collapsing the entire user base into one rate-limit bucket.

## Metrics schema alignment
`computeMetrics` now returns `architectureScore` (file-structure heuristic) and `testCoverage` (test-file ratio proxy). Both are stored in `metrics` table. `testsPassed`/`testsTotal` are intentionally left null — require a test runner.

**Why:** DB schema fields were unpopulated; leaving them null made dashboards show misleading zero or missing values.

## Codegen gate
Root `build` script now runs `pnpm run codegen` first. `pnpm run test` delegates to all packages with a `test` script.

**Why:** OpenAPI → generated client drift was the #1 critical risk in the audit. Gating build on codegen ensures the client stays in sync.

## Test suite location
Scanner unit tests live in `lib/scanner/src/__tests__/`. Vitest v4 configured via `lib/scanner/vitest.config.ts`. Run with `pnpm --filter @workspace/scanner run test`.

Key behavioral facts the tests encode:
- `matchRules` omits disabled/null-pattern rules from results (no entry, not matched=false)
- Import relationship resolution requires bare specifiers (`./utils` not `./utils.js`) or the resolver adds the wrong double-extension
- `walkProject` does not throw on non-existent paths — it falls back to cwd with `rootExists=false`
