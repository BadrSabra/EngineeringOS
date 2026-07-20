---
name: Forensic audit PR-01–08
description: 8 forensic-audit PRs closed 2026-07-20 — advisory locks, real doc extraction, route parity test, OpenAPI sync, codegen regeneration, UX copy.
---

## What was done (2026-07-20)

**PR-03 — OpenAPI sync:** Added 4 live AI endpoints missing from `lib/api-spec/openapi.yaml`:
- `GET/PUT/DELETE /api/ai/deepseek-key` (schemas: DeepSeekKeyStatus, SaveDeepSeekKeyInput)
- `GET /api/ai/active-provider` (schema: ActiveProviderStatus)
- Model: followed the existing GroqKeyStatus block at line 1941 as template.

**PR-04 — Codegen:** `pnpm codegen` regenerated orval zod + React Query client after PR-03.  
Fixed a pre-existing TS error in `lib/ai-orchestrator/src/context-builder.test.ts`: `typeof _mockDb` circular reference inside `vi.hoisted()` — fix was to declare an explicit `interface MockDb` and type the const with it.

**PR-01 — Job queue durability comment:** Updated misleading `job-queue.ts` JSDoc (which said "pg-boss migration needed") to accurately state that reconciliation already re-enqueues queued/pending jobs at startup.

**PR-02 — Distributed advisory lock:**
- New file: `artifacts/api-server/src/lib/advisory-lock.ts`
- Exports `tryAdvisoryLock(namespace, id)` returning `{ acquired: false } | { acquired: true; release() }`.
- Uses `pool.connect()` (dedicated connection) + `pg_try_advisory_lock(int4, int4)` — session-scoped so same connection must be used for lock+unlock.
- Hash function: djb2 on the string ID → signed int32.
- Namespaces: `LockNamespace.ORCHESTRATION = 1001`, `LockNamespace.APPLY = 1002`.
- Removed `_orchestratingWorkflows` and `_applyingProjects` Sets from `routes/ai.ts`.
- Chat endpoint's apply-in-progress check: probe with `tryAdvisoryLock` and immediately release if acquired (non-blocking).

**PR-05 — Real doc extraction:**
- Added `isDocumented?: boolean` to `ExtractedEntity` interface in `plugin-runtime.ts`.
- Updated `scan-runner.ts` `capturedEntities` map to include `isDocumented: e.isDocumented`.
- Updated `plugin-docs.onScanComplete` to use real `entity.isDocumented` when available; falls back to entity-density heuristic only when `isDocumented` is undefined on all entities (legacy scan data).

**PR-06 — Route parity test:**
- File: `artifacts/api-server/src/routes/ai-route-parity.test.ts`
- Three tests: code-only routes fail, spec-only routes fail, baseline routes always covered.
- Parses routes from `ai.ts` source via regex (`router.METHOD("/ai/path"`).
- Parses paths from `openapi.yaml` via line scanning; excludes Git-tagged-only paths.
- Exemption: `POST /api/ai/chat/stream` (SSE, hard to describe in OAS 3.0).
- All 3 tests pass; included in `pnpm test` suite.

**PR-07 — Docs refresh:** `docs/PR_BACKLOG.md` closed-PRs table updated with all 8 PRs + dates.

**PR-08 — UX cleanup (`AiChat.tsx`):**
- Removed opinionated "higher quality than Groq" copy from DeepSeek key card.
- Changed "Preferred" badge to "Optional" (neutral, factual).

## Key durable rules

**Why explicit MockDb interface in vi.hoisted():** TypeScript cannot infer `typeof T` when T references itself in its own initializer — always use an explicit named interface in this pattern.

**Why dedicated pool connection for advisory locks:** `pg_try_advisory_lock` and `pg_advisory_unlock` must run on the same Postgres session. With a pool, different `db.execute()` calls can land on different connections. Always use `pool.connect()` → dedicated client → release in finally.

**Why probe-and-release for the chat/apply guard:** The alternative (keeping a separate in-memory flag alongside the DB lock) breaks on multi-instance deployments. Probe is safe because the worst-case race is building context immediately after an apply completes — which is correct behavior.
