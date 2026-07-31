---
name: PR-H and PR-I completion
description: Job queue observability (H-1) and SSE AI chat streaming — implementation decisions and patterns.
---

## PR-H — Job Queue Crash Safety (H-1 path chosen)

**Rule:** H-1 (document + expose stats) was implemented over H-2 (pg-boss migration).

**Why:** The reconciliation layer already marks stale DB rows as `failed` on startup, so the behavior is already honest. H-1 makes it _observable_ without the schema migration risk of H-2.

**How to apply:**
- `heavyJobQueue.getStats()` returns `{ running, queued, concurrency }`.
- `GET /api/healthz` now includes `jobQueue: getStats()` in the response body.
- Startup log emits `jobQueue` stats alongside `port`.
- OpenAPI: `HealthStatus.jobQueue` references `JobQueueStats` schema.
- If H-2 (pg-boss) is ever needed, the `getStats()` interface can stay; only the `JobQueue` class internals change.

## PR-I — SSE Streaming for AI Chat

**Rule:** New `POST /api/ai/chat/stream` endpoint emits SSE; original `POST /api/ai/chat` (JSON) kept as fallback.

**Why:** Preserves backward compatibility for programmatic clients while giving the UI real progress feedback.

**Event sequence:**
1. `{ type: "stage", stage: "building-context" }` — before `buildProjectContext()`
2. `{ type: "stage", stage: "calling-model" }` — before `chat()`
3. `{ type: "done", sessionId, message, sources, pendingChanges }` — after DB writes succeed
4. `{ type: "error", code, message, hint?, raw?, parseCode? }` — on any failure (GroqClientError, parse failure, etc.)

**Client hook:** `useAiChatStream` in `lib/api-client-react/src/use-ai-chat-stream.ts` (handwritten; Orval cannot generate SSE hooks). Exported from package index.

**AiChat.tsx:** Replaced `sendMutation` (useMutation + timer-based fake stage rotation) with direct `streamSend()` calls. `isSending` from `useAiChatStream` replaces `sendMutation.isPending`. `onStage` callback drives `setAgentStage` with real server labels (`STAGE_LABELS` map). `onDone` / `onError` handle success/failure paths.

**SSE return value gotcha:** Express route handlers with mixed `return res.json(...)` and bare `return` cause TS7030 "not all code paths return a value". Fix: add explicit `return;` after the final `res.end()` at the bottom of the handler.

**OpenAPI:** Added `/api/ai/chat/stream` entry with `text/event-stream` response and `x-no-codegen: true` marker. Codegen must be re-run after any schema changes but this endpoint is excluded from generation.
