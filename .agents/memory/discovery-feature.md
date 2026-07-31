---
name: Autonomous Project Discovery
description: Architecture and correctness rules for the discovery/import feature (POST /projects/discover, /import)
---

## Rule: rootPath must be validated before discovery starts
`runDiscovery()` calls `stat(rootPath)` at step 0 and throws immediately if the path does not exist or is not a directory. The error propagates to the catch block which marks the session `status="error"`. Never rely on the scanner lib's cwd fallback in this pipeline.

**Why:** walkProject() silently falls back to cwd when path is missing, producing a discovery report for the wrong repository.

**How to apply:** Any new discovery source (git clone, workspace) must ensure the local path exists before invoking `runDiscovery`.

## Rule: import transaction + atomic claim
`POST /projects/import` uses a two-phase approach:
1. **Atomic claim**: `UPDATE discovery_sessions SET status='imported' WHERE id=? AND status='ready'` — if 0 rows updated, reject with 409 (already imported).
2. **DB transaction**: all inserts (project, metrics, graph stubs, tasks, event) run inside `db.transaction()`. On failure the tx rolls back and the session is reset to `status='ready'` so it can be retried.

**Why:** Without the claim check, concurrent requests can create duplicate projects from one discovery. Without the transaction, a mid-sequence failure leaves partial state.

**How to apply:** Any future import-like operation (re-import, template apply) should follow the same pattern: claim atomically first, then transact.

## Schema: discovery_sessions
Table lives in `lib/db/src/schema/discovery.ts`. Status enum: `discovering | ready | imported | error`. Field `result` is JSONB holding the full `DiscoveryResultData`. TTL cleanup (24h) runs opportunistically on every `POST /discover`.

## OpenAPI codegen note
After adding the discovery endpoints, `StartDiscoveryBody`, `ImportProjectBody`, `GetDiscoverySessionParams`, `GetDiscoverySummaryParams` schemas are generated in `lib/api-zod/src/generated/api.ts`. Hooks: `useStartDiscovery`, `useGetDiscoverySession`, `useGetDiscoverySummary`, `useImportProject` in `lib/api-client-react`.

## React Query hook options require queryKey
Orval v8 generated hooks require `queryKey` in the `query` options object even for partial configs. Always pass `getXxxQueryKey(...)` alongside `enabled`/`refetchInterval`.

**Why:** TypeScript error TS2741 "Property 'queryKey' is missing" — the generated UseQueryOptions type is not Partial.
