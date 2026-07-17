# AI Orchestrator — PR Backlog (file-by-file)

> Generated from code-review analysis of `lib/ai-orchestrator/src/`.
> Work order: PR-01 → PR-02 → PR-03 (any order) → PR-04 → PR-05 → PR-06 (after 01+02).

---

## PR-01 · Enforce linear phase ordering in workflow orchestrator

**Scope:** `workflow-orchestrator.ts` + `workflow.schema.ts` + tests

**Exact files:**
- `lib/ai-orchestrator/src/agents/workflow-orchestrator.ts`
- `lib/ai-orchestrator/src/schemas/workflow.schema.ts`
- `lib/ai-orchestrator/src/__tests__/workflow-orchestrator.test.ts`

**Problem:**
`validateDecision()` (lines 74-105 of `workflow-orchestrator.ts`) rejects transitions to unknown phases and no-op transitions, but **does not enforce sequential ordering**. A model that proposes `{ action: "advance", nextPhase: "verify" }` while the current phase is `"plan"` (with `"build"` in between) is silently accepted.

Additionally, `WorkflowPhaseSchema.steps` (line 5 of `workflow.schema.ts`) validates each string as non-empty but allows an empty array — a phase with zero steps is structurally invalid.

**Changes:**
1. Add `.min(1)` to the `steps` array in `WorkflowPhaseSchema`:
   ```ts
   steps: z.array(z.string().min(1)).min(1),
   ```
2. In `validateDecision()`, after the existing `knownPhaseNames` check, add a linear-ordering guard:
   ```ts
   if (decision.action === "advance") {
     const phaseNames = state.phases.map((p) => p.name);
     const currentIdx = phaseNames.indexOf(state.currentPhase ?? "");
     const nextIdx = phaseNames.indexOf(decision.nextPhase);
     if (nextIdx !== currentIdx + 1) {
       return rejectedDecision(
         `Rejected "advance" decision: phase "${decision.nextPhase}" is not the immediate successor of "${state.currentPhase}".`
       );
     }
   }
   ```
3. `fallbackDecision()` already emits `{ action: "wait" }` without `blockers` — compatible with the existing `WaitDecisionSchema` (blockers optional). No change needed there.

**Risk:** Low. The guard only fires on non-sequential jumps; all current tests advance one phase at a time.

**Acceptance criteria:**
- `pnpm -r test` passes
- `validateDecision({ action: "advance", nextPhase: "verify" }, { phases: [plan, build, verify], currentPhase: "plan" })` returns a `"wait"` rejection
- `validateDecision({ action: "advance", nextPhase: "build" }, { phases: [plan, build, verify], currentPhase: "plan" })` returns `"advance"` unchanged
- A phase with `steps: []` fails `WorkflowPhaseSchema.parse`

**Tests to add (in `workflow-orchestrator.test.ts`):**
- `"rejects phase skip (plan → verify)"` — verifies the new ordering guard
- `"accepts sequential advance (plan → build)"` — regression guard
- `"rejects WorkflowPhase with empty steps array"` — covers the `.min(1)` addition

---

## PR-02 · Tighten task, scan, code-review, and chat schemas

**Scope:** 4 schema files + fallback outputs + schema tests

**Exact files:**
- `lib/ai-orchestrator/src/schemas/task.schema.ts`
- `lib/ai-orchestrator/src/schemas/scan.schema.ts`
- `lib/ai-orchestrator/src/schemas/code-review.schema.ts`
- `lib/ai-orchestrator/src/schemas/chat.schema.ts`
- `lib/ai-orchestrator/src/agents/scan-analyst.ts` (fallback)
- `lib/ai-orchestrator/src/agents/task-agent.ts` (fallback)
- `lib/ai-orchestrator/src/agents/code-reviewer.ts` (fallback)
- `lib/ai-orchestrator/src/__tests__/schemas.test.ts`

**Problem:**
Most schemas accept extra keys (no `.strict()`) and allow empty strings on fields that carry semantic meaning. A model response that returns `{ summary: "", steps: [] }` for a task passes validation today.

**Changes:**

### `task.schema.ts`
```ts
export const TaskRecommendationSchema = z.object({
  summary:           z.string().min(1),
  steps:             z.array(z.string().min(1)).min(1),
  result:            z.string().min(1),
  confidence:        z.enum(["high", "medium", "low"]),
  needsHumanReview:  z.boolean().default(true),
}).strict();
```

### `scan.schema.ts`
```ts
export const ScanInsightSchema = z.object({
  category:       z.enum(["architecture", "security", "performance", "reliability", "maintainability"]),
  severity:       SeveritySchema,
  title:          z.string().min(1),
  description:    z.string().min(1),
  recommendation: z.string().min(1),
}).strict();

export const ScanSummarySchema = z.object({
  summary:            z.string().min(1),
  overallAssessment:  z.string().min(1),
  insights:           z.array(ScanInsightSchema).default([]),
  topPriority:        z.string().min(1),
  estimatedImpact:    z.string().min(1),
}).strict();
```

### `code-review.schema.ts`
```ts
export const CodeIssueSchema = z.object({
  type:        CodeIssueTypeSchema,
  severity:    SeveritySchema,
  file:        z.string().optional(),
  title:       z.string().min(1),
  description: z.string().min(1),
  suggestion:  z.string().min(1),
}).strict();

export const CodeReviewResultSchema = z.object({
  summary:                   z.string().min(1),
  overallScore:              z.number().min(0).max(100),
  strengths:                 z.array(z.string().min(1)).default([]),
  issues:                    z.array(CodeIssueSchema).default([]),
  refactoringOpportunities:  z.array(z.string().min(1)).default([]),
  securityConcerns:          z.array(z.string().min(1)).default([]),
  verdict:                   z.enum(["approved", "needs_changes", "major_rework"]),
}).strict();
```

### `chat.schema.ts`
Add `.strict()` to `ChatResponseSchema` (PendingChangeSchema already has it):
```ts
export const ChatResponseSchema = z.object({
  response: z.string().min(1),
  sources:  z.array(z.string()).default([]),
}).strict();
```

### Fallback outputs — must remain valid after tightening

**`scan-analyst.ts` `fallbackScanAnalysis()`** — `topPriority` and `estimatedImpact` are currently hardcoded non-empty strings; keep them. `overallAssessment` falls back to `raw.trim() || "..."` — the `"..."` string is non-empty. No change needed.

**`task-agent.ts` `fallbackTaskOutput()`** — `steps: ["Analysis completed"]` is a non-empty array of non-empty strings. `summary`, `result` are non-empty. No change needed.

**`code-reviewer.ts` `fallbackCodeReview()`** — `summary: "Code review completed"`, `verdict: "needs_changes"` are non-empty. No change needed.

**Risk:** Medium. Stricter schemas may cause `parseAgentResponse()` to fall back more often when the model returns borderline output. Monitor in staging before enabling in production Groq calls.

**Acceptance criteria:**
- `pnpm -r test` passes
- All three fallback functions pass `Schema.safeParse(fallbackFn()).success === true`
- `TaskRecommendationSchema.safeParse({ summary: "", steps: [], result: "", confidence: "high", needsHumanReview: false })` fails
- `ScanSummarySchema.safeParse({ ..., extraKey: 1 })` fails
- `CodeIssueSchema.safeParse({ ..., suggestion: "" })` fails

**Tests to add (in `schemas.test.ts`):**
- `"rejects extra fields on TaskRecommendationSchema"`
- `"rejects empty summary on TaskRecommendationSchema"`
- `"rejects empty steps array on TaskRecommendationSchema"`
- `"rejects extra fields on ScanInsightSchema"` and `"ScanSummarySchema"`
- `"rejects empty title/description/recommendation on ScanInsightSchema"`
- `"rejects extra fields on CodeIssueSchema"` and `"CodeReviewResultSchema"`
- `"rejects empty suggestion on CodeIssueSchema"`
- `"rejects extra fields on ChatResponseSchema"`

---

## PR-03 · Unify PendingChange — remove type duplication

**Scope:** `file-tools.ts` imports from schema instead of re-declaring

**Exact files:**
- `lib/ai-orchestrator/src/tools/file-tools.ts`
- `lib/ai-orchestrator/src/schemas/chat.schema.ts` (no change — it is the source)

**Problem:**
`file-tools.ts` line 31 declares its own `PendingChange` type with the same shape as `PendingChangeSchema` in `chat.schema.ts`. Two parallel type definitions for the same runtime object is a drift risk — a future field addition to `PendingChangeSchema` won't automatically apply to the local type in `file-tools.ts`.

**Change:**
In `file-tools.ts`, replace:
```ts
export type PendingChange = {
  path: string;
  absolutePath: string;
  newContent: string;
  originalContent: string | null;
  reason: string;
};
```
with:
```ts
export type { PendingChange } from "../schemas/chat.schema.js";
```
and import `PendingChangeSchema` for any runtime validation at the push site:
```ts
import { PendingChangeSchema, type PendingChange } from "../schemas/chat.schema.js";
```

**Risk:** Low. The shapes are identical; it is a pure type-alias replacement. Verify that no field name in the local definition differs from the schema (they don't — confirmed by code review).

**Acceptance criteria:**
- `pnpm -r typecheck` passes
- `grep -n "export type PendingChange" lib/ai-orchestrator/src/tools/file-tools.ts` returns no results
- All usages of `PendingChange` in `file-tools.ts` resolve to the schema-exported type

**Tests:** No new tests needed. Type-only change; existing test suite confirms no runtime regression.

---

## PR-04 · Widen context-builder task fetch window

**Scope:** `context-builder.ts`

**Exact files:**
- `lib/ai-orchestrator/src/context-builder.ts`

**Problem:**
Line 31 fetches tasks ordered by `updatedAt DESC` with `limit(20)`. Lines 59-66 then re-sort by priority rank (`P0 < P1 < P2 < P3`). A P0 task that was last updated more than 20 tasks ago will never enter the context window — it is excluded before the priority sort runs.

**Change:**
Widen the fetch limit so priority sort has sufficient candidates, then trim:
```ts
// Before (line 31):
.orderBy(desc(tasksTable.updatedAt)).limit(20),

// After:
.orderBy(desc(tasksTable.updatedAt)).limit(50),
```
Keep the post-sort slice at 10 (or whatever the current display cap is) so the context object doesn't balloon.

Alternatively, fetch with a compound `orderBy(asc(priorityRank), desc(updatedAt))` at the DB layer and remove the client-side sort. Either approach is acceptable; the wider window is the minimal-risk fix.

**Risk:** Low. Fetches up to 30 more rows per context build — negligible DB overhead for a project that is unlikely to have hundreds of tasks.

**Acceptance criteria:**
- A P0 task updated 25+ tasks ago appears in `context.recentTasks` after the fix
- `pnpm -r test` passes

**Tests to add:**
- Unit test for `buildProjectContext` with a mocked DB that returns 25 tasks, where task #25 (oldest update) has priority P0 — assert it appears in `recentTasks`.

---

## PR-05 · Differentiate error types in `search_code`

**Scope:** `file-tools.ts` — grep catch block

**Exact files:**
- `lib/ai-orchestrator/src/tools/file-tools.ts`

**Problem:**
The catch block (around line 330) maps both `code === 1` (no matches) and all other failures (timeout, `grep` not found, invalid args, permission denied) to the identical string `"No matches found."`. A timed-out search and a genuinely empty result are indistinguishable to both the model and any debugging console.

**Change:**
```ts
} catch (err) {
  const e = err as { code?: unknown; killed?: boolean; signal?: string };

  // grep exits 1 when no lines match — not an error.
  if (e.code === 1) return "No matches found.";

  // Timeout: execFile sets killed=true and signal="SIGTERM".
  if (e.killed) return 'Error: search timed out. Try a more specific pattern or a narrower root path.';

  // grep binary missing.
  if ((e as NodeJS.ErrnoException).code === "ENOENT") {
    return 'Error: grep is not available in this environment.';
  }

  // Catch-all for anything else (ENOMEM, permission errors, etc.)
  return `Error: search failed (${(e as Error).message ?? "unknown reason"}).`;
}
```

**Risk:** Low. The only behavioral change is the error message text; the model never acted on the old message anyway.

**Acceptance criteria:**
- A mocked `execFile` that throws `{ killed: true }` returns the timeout message
- A mocked `execFile` that throws `{ code: "ENOENT" }` returns the missing-grep message
- A mocked `execFile` that throws `{ code: 1 }` still returns `"No matches found."`
- `pnpm -r test` passes

**Tests to add (new file `lib/ai-orchestrator/src/__tests__/file-tools.test.ts`):**
- `"search_code: no matches → 'No matches found.'"` (code 1)
- `"search_code: timeout → timeout message"` (killed: true)
- `"search_code: grep missing → missing-grep message"` (ENOENT)
- `"search_code: unknown error → generic error message"`

---

## PR-06 · Add `ChatOutputSchema` and validate before return

**Scope:** `chat.schema.ts` + `chat-agent.ts`

**Exact files:**
- `lib/ai-orchestrator/src/schemas/chat.schema.ts`
- `lib/ai-orchestrator/src/agents/chat-agent.ts`

**Problem:**
The chat agent assembles `pendingChanges` server-side after the tool loop (lines 238-256 of `chat-agent.ts`) and returns it without a runtime shape check. If `executeFileTool` produces a malformed `PendingChange` (e.g., a relative `absolutePath`), the bug propagates silently to the client.

**Changes:**

### `chat.schema.ts` — add `ChatOutputSchema`
```ts
export const ChatOutputSchema = ChatResponseSchema.extend({
  pendingChanges: z.array(PendingChangeSchema).default([]),
});
export type ChatOutput = z.infer<typeof ChatOutputSchema>;
```
(Replace the current `ChatOutput` type alias with this schema-derived version.)

### `chat-agent.ts` — validate before return
After `pendingChanges` is assembled, add:
```ts
const output: ChatOutput = { response, sources, pendingChanges };
const check = ChatOutputSchema.safeParse(output);
if (!check.success) {
  console.error(JSON.stringify({ scope: "chat-agent", code: "CHAT_OUTPUT_INVALID", issues: check.error.issues }));
  // Drop malformed pendingChanges rather than returning corrupt data.
  return { response, sources, pendingChanges: [] };
}
return check.data;
```

**Risk:** Low. The parse is a defensive check on server-produced data, not model output. A failure indicates a bug in `executeFileTool`, not LLM drift.

**Acceptance criteria:**
- `ChatOutputSchema.safeParse({ response: "ok", sources: [], pendingChanges: [{ absolutePath: "relative/path", ... }] })` fails
- `pnpm -r test` passes

**Tests to add (new file `lib/ai-orchestrator/src/__tests__/chat-agent.test.ts`):**
- `"chat agent returns empty pendingChanges when executeFileTool produces an invalid absolutePath"`
- `"chat agent returns valid pendingChanges unchanged when all fields are correct"`

---

## PR-07 · Expand test coverage for groq-client error paths

**Scope:** `groq-client.test.ts`

**Exact files:**
- `lib/ai-orchestrator/src/__tests__/groq-client.test.ts`

**Problem:**
The existing test suite covers the happy path and basic retry logic but is missing coverage for HTTP error codes that the client must handle distinctly.

**Tests to add:**
- `"handles 401/403 (auth error) without retry"`
- `"handles 429 (rate limit) with exponential back-off"`
- `"handles 5xx (server error) with retry up to configured limit"`
- `"throws after exhausting all retries"`
- `"selects per-user apiKey over env var when both present"`
- `"falls back to env var GROQ_API_KEY when no per-user key provided"`

**Risk:** None — additive test-only changes.

**Acceptance criteria:**
- All new tests pass
- Coverage for the retry/error-handling paths in `groq-client.ts` is explicit and documented

---

## Dependency order summary

```
PR-01 (workflow ordering)   — standalone
PR-02 (schema tightening)  — standalone; fallback review is a prerequisite
PR-03 (PendingChange unify) — standalone
PR-04 (context window)     — standalone
PR-05 (search_code errors) — standalone
PR-06 (ChatOutputSchema)   — depends on PR-02 (ChatResponseSchema.strict()) and PR-03 (PendingChangeSchema import)
PR-07 (groq-client tests)  — standalone
```
