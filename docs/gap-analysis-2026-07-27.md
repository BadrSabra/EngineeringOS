# EngineeringOS — Gap Analysis
**Date:** 2026-07-27  
**Method:** Live codebase analysis (not a zip archive) — routes, schema, tests, spec, and dashboard audited in parallel.  
**Baseline:** All 510 tests passing, typecheck clean before this analysis.

---

## Summary

The project is architecturally sound. No route has a missing implementation, no spec path lacks a handler, and no test suite is outright broken. The gaps below are **functional incompletions**, not structural failures — they are the difference between "it compiles and runs" and "every visible surface works end-to-end."

Five confirmed gaps, ranked by user-visible impact:

| # | Gap | Layer | Severity | Effort |
|---|-----|-------|----------|--------|
| GAP-1 | Gemini provider has no key management route or UI | API + Dashboard | High | Small |
| GAP-2 | AiChat quick-action buttons are decorative (don't call specialized endpoints) | Dashboard | Medium | Small |
| GAP-3 | AI and Git dashboard routes bypass the generated API client | Dashboard | Medium | Medium |
| GAP-4 | Dual key management API patterns — legacy + generic coexist | API | Low (tech debt) | Small |
| GAP-5 | `chat-agent.ts` provider dispatch is a hardcoded if/else chain | `lib/ai-orchestrator` | Low (tech debt) | Small |

---

## GAP-1 — Gemini provider has no key management route or UI

### Symptom
Users cannot configure their Gemini API key through the app. There is no `/api/ai/gemini-key` endpoint and no UI for it, unlike Groq, DeepSeek, and OpenRouter.

### Immediate cause
The per-provider legacy key routes were only created for three providers. The Gemini provider was added later and never got the same treatment.

### Root cause
The generic `/api/ai/providers/:provider/key` route exists and would work for Gemini — but it is not listed in the OpenAPI spec for Gemini, and the dashboard's AI settings UI hard-codes only the three legacy providers (Groq, DeepSeek, OpenRouter). The generic route is present but effectively invisible.

### Evidence
- `lib/ai-orchestrator/src/agent-complete.ts:53` — `case "gemini":` is wired in the provider dispatch
- `lib/ai-orchestrator/src/agents/chat-agent.ts:211` — `provider?: "groq" | "deepseek" | "openrouter" | "gemini"`
- `artifacts/api-server/src/routes/ai/providers.ts:163–173` — legacy routes for groq/deepseek/openrouter only
- `lib/api-spec/openapi.yaml` — no `/api/ai/gemini-key` path
- `artifacts/api-server/src/routes/ai.test.ts:839` — tests set `GEMINI_API_KEY` directly as env var, confirming it has no DB-backed key management

### Affected files
- `artifacts/api-server/src/routes/ai/providers.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/` (needs codegen after spec change)
- `lib/api-client-react/src/generated/` (needs codegen after spec change)
- `artifacts/dashboard/src/pages/AiChat.tsx` (AI settings section)

### Remediation order
1. Add `GET/PUT/DELETE /api/ai/gemini-key` to the spec (mirroring the groq/deepseek/openrouter entries) — or extend the generic `/api/ai/providers/:provider/key` spec entry to explicitly enumerate all four providers
2. Add handler in `providers.ts` (one-liner alias to the generic handler)
3. Run `pnpm codegen`
4. Add Gemini key field in the dashboard AI settings panel

### Acceptance
- `PUT /api/ai/gemini-key` stores key; `GET` returns masked; `DELETE` clears
- AI settings panel shows a Gemini key input alongside the other providers
- `GET /api/ai/active-provider` can return `"gemini"` when it is the highest-priority key with a valid configuration

---

## GAP-2 — AiChat quick-action buttons are decorative

### Symptom
The four quick-action buttons in AiChat ("Analyze Scan", "Code Review", "Task Status", "Workflow Health") appear to trigger specialized analysis, but they only prefill the text input with a prompt string. The user still has to click Send.

More critically: two of the four map to dedicated backend endpoints that perform structured analysis and return typed results — but the UI never calls them.

### Immediate cause
The quick-action button handler (`AiChat.tsx:703`) only calls `setInputValue(action.prompt)`. It never calls `useAiAnalyzeProject` or `useAiReviewCode`.

### Root cause
The analyze and review endpoints were added to the API (`POST /api/ai/projects/:projectId/analyze`, `POST /api/ai/projects/:projectId/review`) and their hooks were generated into the client (`useAiAnalyzeProject`, `useAiReviewCode` in `lib/api-client-react/src/generated/api.ts:4928,4939`), but the dashboard integration was never completed.

### Evidence
- `artifacts/dashboard/src/pages/AiChat.tsx:704–707` — quick actions array; each entry only has a `prompt` string
- `lib/api-client-react/src/generated/api.ts:4928` — `useAiAnalyzeProject` hook exists and returns `AiScanAnalysis`
- `lib/api-client-react/src/generated/api.ts:4939` — `useAiReviewCode` hook exists and returns `AiCodeReview`
- `artifacts/api-server/src/routes/ai/analysis.ts` — both routes are implemented server-side

### Affected files
- `artifacts/dashboard/src/pages/AiChat.tsx` — quick-action handler and result rendering

### Remediation order
1. For "Analyze Scan" and "Code Review" buttons: call the mutation hook directly when a project is selected; display the structured result (score breakdown, recommendations) in the chat thread rather than sending to the free-form chat agent
2. For "Task Status" and "Workflow Health": these legitimately go through the chat agent — wire them to send immediately (skip the `setInputValue` + manual submit step)

### Acceptance
- Clicking "Analyze Scan" fires `POST /api/ai/projects/:projectId/analyze` and renders the returned `AiScanAnalysis` in the chat thread
- Clicking "Code Review" fires `POST /api/ai/projects/:projectId/review` and renders `AiCodeReview`
- Clicking "Task Status" / "Workflow Health" auto-submits the prompt without requiring a second click

---

## GAP-3 — AI and Git routes bypass the generated API client

### Symptom
The AiChat page and GitPanel component make API calls that are not routed through `@workspace/api-client-react`. This means:
- Type-checking at the call site is manual/loose (`as` casts against raw fetch)
- React Query cache is bypassed — mutations don't automatically invalidate related queries
- When the API spec changes, these call sites are not caught by `pnpm codegen:check`

### Root cause
The AI and Git routes were built during a period when the generated client was incomplete or not yet regenerated. The manual `apiFetch` calls were the pragmatic choice at the time but were never replaced after codegen caught up.

### Evidence
- `artifacts/dashboard/src/pages/AiChat.tsx` — calls `/api/ai/deepseek-key`, `/api/ai/groq-key`, `/api/ai/openrouter-key`, `/api/ai/active-provider`, `/api/ai/chat/sessions`, `/api/ai/chat/:id/messages`, `/api/ai/chat/apply-changes` via raw `apiFetch`
- `artifacts/dashboard/src/components/GitPanel.tsx` — calls `/api/projects/:id/git/config`, `/api/ai/github-token`, `/api/projects/:id/git/status`, `/api/projects/:id/git/log`, `/api/projects/:id/git/commit`, `/api/projects/:id/git/push` via raw `apiFetch`
- `lib/api-client-react/src/generated/api.ts` — all of these endpoints have generated hooks

### Affected files
- `artifacts/dashboard/src/pages/AiChat.tsx`
- `artifacts/dashboard/src/components/GitPanel.tsx`

### Remediation order
1. Replace raw `apiFetch` calls with the generated hooks one call-site at a time
2. Start with the read paths (GET calls) — lower risk, immediate query cache benefit
3. Then replace write paths (PUT/POST/DELETE)
4. Note: the SSE streaming endpoint (`/api/ai/chat/stream`) cannot use the standard generated client; keep the custom `useAiChatStream` hook for that one

### Acceptance
- `AiChat.tsx` and `GitPanel.tsx` import from `@workspace/api-client-react` for all non-streaming calls
- `pnpm codegen:check` would catch future drift in these paths

---

## GAP-4 — Dual key management API patterns

### Symptom
Two parallel API patterns exist for managing provider API keys:
- **Legacy (per-provider):** `GET/PUT/DELETE /api/ai/groq-key`, `/api/ai/deepseek-key`, `/api/ai/openrouter-key`
- **Generic:** `GET/PUT/DELETE /api/ai/providers/:provider/key`

Both are in the spec, both are in the routes, both are in the generated client. This is pure duplication.

### Root cause
The generic route was added as a cleaner abstraction but the legacy routes were not removed — likely to avoid breaking existing dashboard code that already called them.

### Evidence
- `artifacts/api-server/src/routes/ai/providers.ts:121–173` — both patterns registered
- `lib/api-spec/openapi.yaml` — both `/api/ai/groq-key` and `/api/ai/providers/{provider}/key` defined

### Remediation
1. Migrate dashboard call sites to the generic route
2. Mark legacy routes as deprecated in the spec
3. Remove legacy routes in a follow-up once no callers remain
4. This is low urgency — the duplication causes no bugs, only spec bloat

---

## GAP-5 — `chat-agent.ts` provider dispatch is hardcoded

### Symptom
Adding a new AI provider to the chat agent requires edits in 3+ places inside `chat-agent.ts` — each conditional chain (complete function selection, fast model, powerful model) must be extended manually.

### Root cause
The PROVIDER_REGISTRY pattern exists in `agent-complete.ts` and works correctly there. `chat-agent.ts` was written before the registry was mature and was never refactored to use it.

### Evidence
- `lib/ai-orchestrator/src/agents/chat-agent.ts:224–245` — three separate ternary chains for `completeFn`, `fastModel`, `powerfulModel`
- `lib/ai-orchestrator/src/agent-complete.ts:53` — `switch (opts.provider)` dispatches correctly via the registry

### Remediation
Replace the three ternary chains in `chat-agent.ts` with a lookup against `PROVIDER_REGISTRY[provider]`, matching the pattern already used in `agent-complete.ts`.

---

## What is NOT a gap

These were flagged by analysis but are working as designed:

| Item | Why it's fine |
|---|---|
| Context-builder "placeholder metrics" warning | Intentional — the AI is explicitly warned when metrics come from an unverified scan. Correct behavior. |
| `POST /projects/discover` missing from route list | It IS implemented — `artifacts/api-server/src/routes/discovery.ts:133`. The grep missed it. |
| Missing DB indexes (events, audit_logs, etc.) | All indexes are present. The subagent was incorrect — direct grep confirmed `idx_events_project_id_timestamp`, `idx_audit_logs_project_id`, etc. |
| Disabled discovery sources (SSH, Docker) | Correct `501 Not Implemented` behavior. By design. |
| `GET /api/healthz` vs `/healthz` in spec | The spec path is `/api/healthz`; the route registers `/healthz`. The health router is mounted at `/api` in `routes/index.ts`, so the resolved path is correct. |
| `metricsVerified` gate blocking workflow advance | Correct guard behavior. |

---

## Recommended execution order

```
GAP-1 (Gemini key)     ── fast, high user value
  │
  └──► GAP-2 (Quick actions)   ── wires existing endpoints to UI
         │
         └──► GAP-3 (Client migration)   ── medium scope; do after quick-action work stabilizes AI page
                │
                └──► GAP-4 + GAP-5   ── cleanup; do last, low urgency
```
