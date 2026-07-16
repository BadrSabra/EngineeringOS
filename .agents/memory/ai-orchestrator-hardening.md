---
name: ai-orchestrator hardening
description: Design decisions from hardening lib/ai-orchestrator (prompts, schemas, parsing, groq-client, workflow-orchestrator).
---

- Prompts live in `prompts/*.prompt.ts` (pure string builders), zod schemas in `schemas/*.schema.ts`. Agents only compose these + `parsing.ts` — no inline prompt text or raw `JSON.parse` in agent files.
- `parseAgentResponse(raw, schema, fallback)` in `parsing.ts` is the single parsing/validation chokepoint: strips code fences, locates a JSON substring among commentary, `safeParse`s against the schema, and returns the caller's fallback (never throws) with an `AgentErrorCode` (`EMPTY_MODEL_RESPONSE` | `MALFORMED_JSON` | `SCHEMA_VALIDATION_FAILED`) for logging.
  - **Why:** models routinely wrap JSON in fences or add commentary; every agent had its own ad hoc try/catch before.
- Gotcha: a generic `function f<T>(schema: ZodType<T>, ...)` binds `T` incorrectly when the schema has `.default()` fields — TS infers `T` from the *input* type (fields optional) not the *output* type (defaults applied, required), causing spurious "optional not assignable to required" errors at call sites. Fix: type the param as `ZodType<T, ZodTypeDef, any>` so only Output binds T.
- `workflow-orchestrator.ts` splits into `decide()` (calls the model) → `validateDecision()` (pure guard: rejects unknown/no-op/out-of-order transitions, downgrades to a safe "wait") → `executeDecision()` (pure state transition). `orchestrateWorkflow()` composes decide+validate for backward compat with existing callers.
- `groq-client.ts` classifies every failure into a `GroqClientError` with a `code` (`TIMEOUT`|`NETWORK_ERROR`|`NON_200`|`EMPTY_RESPONSE`|`INVALID_CONFIG`), has an AbortController-based timeout, and retries only `TIMEOUT`/`NETWORK_ERROR` up to a small bounded count — never retries on 4xx/empty-response/schema issues.
- Agent-level parse/schema failures never throw to Express (route has no try/catch); only groq-client transport failures throw and hit the app's central error handler. Keep this split when adding new agents.
