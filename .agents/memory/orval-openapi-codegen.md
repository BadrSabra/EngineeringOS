---
name: Orval/OpenAPI codegen gotchas (EngineeringOS)
description: Non-obvious rules for adding endpoints to lib/api-spec/openapi.yaml so codegen doesn't break.
---

Two collision patterns in this project — both cause `TS2308: already exported a member` in
`lib/api-zod/src/index.ts` when it re-exports `./generated/api` + `./generated/types`:

**Pattern 1 — inline request-body schemas:**
Orval emits `generated/types/<OperationId>Body.ts` for inline bodies AND names the zod schema in
`generated/api.ts` the same. Fix: give any non-empty request body a named `$ref` schema under
`components/schemas`. Empty/no-body POSTs are unaffected.

**Pattern 2 — endpoints with BOTH path params AND query params:**
Orval emits `generated/types/<OperationId>Params.ts` (TS type combining path+query) AND a Zod schema
named `<OperationId>Params` in `generated/api.ts` — same name, different files, causes TS2308.
Endpoints with ONLY query params are safe (type gets `...Params`, Zod schema gets `...QueryParams` —
different names). Endpoints with ONLY path params are safe (no individual type file generated).
Fix: restructure path+query endpoints to use ALL query params (move the "entity id" to a query param),
turning them into query-only endpoints which use the `...QueryParams` naming pattern.

**Why (pattern 2):** hit adding `GET /api/graph/entities/{entityId}/impact?maxDepth=3` — moved to
`GET /api/graph/impact?entityId=&maxDepth=` to resolve.

**Also:** codegen appends to `lib/api-zod/src/index.ts` instead of replacing it on some runs —
check for duplicate `export *` lines after codegen and deduplicate if present.

**Verification:** run `pnpm run codegen:check` (already in root package.json) or
`scripts/check-codegen-drift.ts` after any openapi.yaml change to confirm no generated-file drift.
