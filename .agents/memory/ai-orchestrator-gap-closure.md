---
name: AI orchestrator gap closure
description: All gaps verified and closed across the AI orchestrator layer — security, reliability, validation, audit, and testing.
---

## Gaps verified as already correct (false positives in executive table)
- `schemas/code-review.schema.ts` — `overallScore` already had `.min(0).max(100)`
- `schemas/task.schema.ts` — `steps` already had `z.array(z.string().min(1)).min(1)`
- `tools/file-tools.ts` — grep already had `timeout: 10_000` + `maxBuffer: 1_000_000`
- `tools/file-tools.ts` — `safePath` already handled new-file ancestor walk
- `agents/chat-agent.ts` — MAX_TOOL_ITERATIONS exhaustion already returned user-visible message
- `prompts/review.prompt.ts` — fileContents already sliced to max 5 files × 1 500 chars

## Batch 1 — Security & audit (5 gaps)
1. `write_file` extension blocklist — blocks `.env*`, `.sh/.bash/.ps1/.bat`, TLS material. Regex applied BEFORE safePath.
2. `apply-changes` same blocklist on disk write — mirrors file-tools check on the route side.
3. `/review` fileContents validation — 3 checks: no absolute paths, no `..`, total ≤ 50 KB (returns 413).
4. `recordAudit` for analyze/review/orchestrate — previously only apply-changes and execute had audit trails.
5. `orchestrate` in-memory concurrency lock — `_orchestratingWorkflows: Set<string>` returns 409 on duplicate; `finally` always releases.

## Batch 2 — Reliability & validation (4 gaps)
6. Circuit breaker in `groq-client.ts` — `_circuits: Map<string, CircuitEntry>` per API key.
   - CLOSED → OPEN after 5 consecutive final-call failures.
   - OPEN → HALF_OPEN after 60 s cooldown; one probe; success → CLOSED.
   - Both `complete()` and `completeRaw()` integrated with `circuitCheck`/`circuitRecord`.
7. Per-project LLM rate limiting — sliding window, 20 calls/min, shared across all 5 LLM endpoints.
   - `_projectCallTimestamps: Map<string, number[]>` + `checkProjectRateLimit()`.
   - Rate limit in execute placed BEFORE atomic claim to avoid stuck "running" tasks.
8. Zod body validation for `/ai/chat` — `z.string().trim().min(1)` catches blank messages; `required_error` + path-aware "Required" replacement for missing fields.
9. Zod body validation for `/ai/workflows/:id/orchestrate` — `additionalContext` capped at 2 000 chars.

## Batch 3 — Integration test (1 gap)
10. `context-builder.test.ts` — 8 tests in `lib/ai-orchestrator/src/`.
    - Drizzle mock: `vi.hoisted()` is REQUIRED. `_tableData` and `_mockDb` must be initialised via `vi.hoisted()` before `vi.mock` hoisting, or you get TDZ "Cannot access before initialization".
    - `drizzle-orm` must also be mocked (eq/desc/asc) because column references on token table objects are `undefined`.
    - Zod error "Required" for missing fields: use `{ required_error: "field is required" }` constructor option, not `.min(1, msg)` (which only fires when the field is present but empty).

## Final test counts
- `@workspace/ai-orchestrator`: 150/150 (7 test files, includes new context-builder.test.ts)
- `@workspace/api-server`: 314/314 (19 test files)
