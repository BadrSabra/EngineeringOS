# EngineeringOS AI Layer Deep Analysis

**Audit date:** 2026-09-04
**Scope:** Dashboard → API → `ai-orchestrator` → database → Dashboard, including
provider/model selection, context, tools, evidence, persistence, recovery, and
public result contracts.
**Method:** Static source inspection and inspection of existing deterministic
fixtures/tests. No provider credential was used, no upstream request was sent,
and the inspected test suites were not executed.
**Change boundary:** This report does not change runtime code, database schema,
provider credentials, or Dashboard behavior.

## 1. Executive conclusion

The AI layer has a mature safety-oriented architecture. The most important
design choice is that the model is not the authority for project ownership,
tool permission, write approval, validation profiles, evidence verdicts, or
terminal state. Those decisions are server-owned and are carried through
durable execution rows, checkpoint envelopes, correlation IDs, and public
redaction projections.

The strongest controls found are:

- Clerk authentication and user/project-scoped execution lookup at the API
  boundary.
- A single `TurnIntent` routing object carried through chat, planning, tools,
  evidence, persistence, and UI metadata.
- Frozen `ExecutionPlan` selection through the decision engine rather than
  reconstructing policy in each agent.
- Provider lifecycle state, model capability selection, bounded retry/fallback,
  and a request-owned `ExecutionLedger`.
- Lexical plus realpath containment before file access and immediately before
  non-shell process execution.
- Server-owned tool manifests and post-model authorization checks.
- Operation/revision/correlation checks for scanner, graph, and discovery
  evidence.
- Durable execution ownership, leases, checkpoints, idempotency, cancellation,
  resume, and explicit incomplete/cancelled outcomes.
- Redacted JSON/history/SSE/audit projections with deterministic tests for
  several parity and adversarial cases.

The audit also found one **high-priority public-boundary defect** and several
medium-priority risks or test gaps:

1. `GET /api/ai/executions/:executionId` returns raw `execution.error` or
   `checkpoint.detail` as `terminalReason`, despite the response's own claim
   that provider/worker diagnostics are server-only. The Dashboard renders it
   verbatim.
2. Tool approval manifests are optional in `authorizeToolInvocation`; a caller
   that reaches `APPROVED` without supplying path/profile constraints can
   authorize a root-contained write or validation profile more broadly than
   intended. The current server call sites may supply the constraints, but the
   helper itself does not enforce that invariant.
3. Context execution admission only checks `scanCompleteness === "COMPLETE"`;
   it does not itself require a matching revision, repository manifest,
   correlation ID, or scanner version.
4. Context admission intentionally always admits project and expanded graph
   slices, so the reported token budget can be exceeded without an explicit
   `budgetExceeded` state.
5. SSE contracts are hand-maintained and only partially runtime-validated;
   the OpenAPI route is exempted from normal parity checks.
6. The default release gate does not require the Dashboard preview journey.
7. Analysis/review event writes do not consistently carry the correlation ID
   consumed by `operation-evidence`, which can produce incomplete audit
   projections for otherwise successful runs.

These findings do **not** establish that live AI is healthy or unhealthy. They
establish the static architecture and provider-free behavior only. A real
provider credential, disposable project, and controlled live campaign are
required to prove upstream model compatibility, provider fallback behavior,
deployment-proxy SSE framing, and end-to-end latency/recovery behavior.

## 2. Architecture and end-to-end request path

### 2.1 Entry and trust boundaries

1. `artifacts/dashboard/src/pages/AiChat.tsx` presents the chat, activity,
   execution, recovery, evidence, history, and audit-preview surfaces. It uses
   generated API hooks and a browser SSE client rather than treating the SSE
   connection as the durable execution owner.
2. The API application mounts the AI router behind
   `rejectCrossOriginMutations` and `requireAuth`
   (`artifacts/api-server/src/app.ts`, AI router mount; Clerk binding in
   `artifacts/api-server/src/middlewares/requireAuth.ts`).
3. Project-scoped routes use `requireProjectAccess` or
   `loadProjectByIdForUser`
   (`artifacts/api-server/src/middlewares/requireProjectAccess.ts`). Execution
   control routes use `getAiExecutionForUser`, so an execution ID alone does
   not grant access to another user's run.
4. `artifacts/api-server/src/routes/ai/index.ts` composes provider,
   chat/stream, analysis/review, task, workflow, recipe, benchmark, and
   operator-alert routes.

### 2.2 Chat request routing

For a chat request, `artifacts/api-server/src/routes/ai/chat.ts` validates the
request envelope, resolves the project/session/task relationship, and creates
or resumes durable execution state. Cross-project session/task combinations are
rejected before the orchestrator is allowed to operate.

`lib/ai-orchestrator/src/turn-intent.ts:resolveTurnIntent` is the routing
decision shared by the API/orchestrator/model/tool/UI path. It distinguishes:

- `CHAT` — lightweight, tool-free conversational work.
- `PROJECT_QUERY` — project inspection with read capability.
- `FORENSIC_AUDIT` — evidence-required work with bounded scope and incomplete
  verdicts when proof is missing.
- `DELIVERY` — execution or proposal-capable work.

The intent includes `requiresTools`, `requiresEvidence`, ordered phases,
resume/build-handoff state, and the audit scope. It is a planning and routing
contract, not by itself a permission grant. Write authorization is separately
derived by `isWriteCapableTurn` and server-owned approval state.

### 2.3 Context and prompt construction

`lib/ai-orchestrator/src/model-selection/decision-engine.ts:resolveExecutionDecision`
creates and freezes the `ExecutionPlan`. The plan controls quality profile,
context intensity/budget, graph mode, history/memory, provider hints, and
retry limits.

`lib/ai-orchestrator/src/context-builder.ts:buildProjectContext` then:

1. Loads project-scoped rows through `context-loader`.
2. Wraps loaded data in typed slices with health, freshness, source, row count,
   and load metadata.
3. Runs admission and lifetime policies.
4. Builds bounded, relative-path context links from server-loaded rows.
5. Attaches a server-owned authorized tool manifest.
6. Projects context provenance and validates the result against strict
   context-contract schemas.
7. Avoids caching contexts that contain load failures.

The final prompt is assembled by the agent. Repository, provider, tool, and
memory text is data/evidence, not an authorization source. The explicit
untrusted envelope is implemented in
`lib/ai-orchestrator/src/untrusted-content.ts`.

### 2.4 Provider and model selection

`provider-registry.ts` is the provider metadata/strategy registry for Groq,
OpenRouter, Gemini, and DeepSeek. `model-selection/provider-strategy.ts`
selects a preferred provider or the best provider matching strict/relaxed
capability hints. `model-selection/model-resolver.ts` selects capability,
fast/powerful quality, and model fallback chain.

The OpenRouter path is catalog-driven:

- `resolveFallbackChain` supplies the current compatible free-model chain.
- `provider-lifecycle.ts` maintains credential fingerprints, revisions,
  last-known-good state, catalog/model health, and capability status.
- An environment-pinned model is accepted only when it remains a usable
  catalog model for the requested capability.

`agent-complete.ts:agentComplete` resolves the plan/provider/model, optionally
performs an explicitly enabled lifecycle check, passes cancellation and the
request ledger to the provider path, and rejects empty content.

For structured single-shot agents, `lib/ai-orchestrator/src/agents/base-agent.ts`
keeps the same sequence consistent: build messages, resolve the execution plan,
complete with bounded provider retry, parse against the declared Zod schema,
and optionally perform a quality correction retry. Parse failures and quality
failures are returned as typed markers rather than being silently presented as
successful structured output.

Provider-specific strategies normalize the OpenAI-compatible response shape.
`openai-compatible-client.ts` classifies authentication, quota, rate limit,
server, model, plan, request-shape, and unavailable-model errors. Retry and
fallback remain bounded by the request ledger and the provider options.

### 2.5 Tool loop and evidence

`chat-agent.ts:chat` supplies the model with the policy-selected tools.
`tool-execution-engine.ts:executeSingleTool` rechecks the server-owned
authorization after the model returns a tool call. The model can request a
tool, but it cannot grant itself:

- a project root;
- a file path;
- a write approval;
- a command or shell string;
- a validation profile;
- an analysis correlation identity; or
- a completed evidence verdict.

Read/write/validation/execution/analysis tools are distinct in
`tool-policy.ts`. File tools perform lexical and realpath containment in
`tools/file-tools.ts`; process execution rechecks root/cwd identity in
`execution-kernel.ts`; terminal actions use server-owned command profiles.

Analysis tools carry an `AnalysisCorrelation` containing operation, project,
revision, root availability, and evidence provenance. Complete results with
missing, cross-operation, or stale correlation are rejected in
`tools/analysis-tools.ts`.

Forensic output is gated by retained complete reads, source scope, evidence
lineage, revision/correlation checks, and output contracts in
`forensic-output-guard.ts`, `evidence-integrity.ts`, and
`forensic-recovery.ts`. Cancellation and incomplete reads cannot become a
verified finding or a source-grounded no-finding.

### 2.6 Durable execution and result projection

The `ai_executions` row is the control plane, not the SSE connection:

- request identity, project/session/user binding, idempotency key;
- operation/correlation identity;
- status, attempt, worker lease, heartbeat, and cancellation;
- checkpoint and checkpoint version;
- final message/proposal identity;
- workspace/base revision and bounded receipt.

`ai-execution-state.ts` performs ownership and monotonic checkpoint checks.
`task-execution-service.ts` passes abort signals into the orchestrator and
checks cancellation/ownership before publishing a terminal success.

The API persists bounded chat message fields in `ai_chat_messages`, including
intent, execution ID, outcome, error code/message, task result, tool trace,
repair-plan metadata, and mission-correlation projection. Proposed changes are
held in `ai_change_proposals`; applied changes are recorded in the append-only
`ai_apply_journal`.

The analysis/review JSON routes and their SSE counterparts in
`artifacts/api-server/src/routes/ai/analysis.ts` use the same project access,
provider error mapping, bounded structured result, and terminal stream
discipline. The chat route additionally persists the durable execution identity
before streaming so a dropped browser connection is not treated as a dropped
operation.

`chat.ts` exposes separate public projections for live JSON, SSE done payload,
history, status, recovery, and audit export. `operation-evidence.ts` builds a
redacted, non-verified-by-default evidence projection from correlated events,
audit rows, task logs, journal entries, proposals, checkpoints, and revisions.

## 3. Control matrix

| Area | Current control and evidence | Assessment | Severity / likelihood | Required follow-up |
|---|---|---|---|---|
| Authentication and project access | Global Clerk `requireAuth`; project middleware; user-scoped execution lookup; cross-project session/task rejection (`app.ts`, `requireAuth.ts`, `requireProjectAccess.ts`, `chat.ts`) | **Sound** | Low / low | Keep route-level ownership tests for every new AI endpoint. |
| Intent routing | One `TurnIntent` with CHAT, PROJECT_QUERY, FORENSIC_AUDIT, DELIVERY and ordered phases (`turn-intent.ts`) | **Sound** | Medium / low | Preserve the rule that intent is not permission. |
| Execution plan | Central frozen decision via `resolveExecutionDecision` (`decision-engine.ts`, `execution-plan.ts`) | **Sound** | Medium / low | Add a contract test that every agent/route uses the authoritative entry point. |
| Provider registry | Four provider strategies and capability metadata (`provider-registry.ts`, `provider-strategy.ts`) | **Sound** | Medium / low | Keep registry/strategy/model defaults in one consistency check. |
| Preferred-provider matching | `resolveExecutionProvider` returns a supplied preferred provider without capability discovery (`model-selection/provider-strategy.ts`) | **Potential risk** | Medium / medium | Validate preferred provider against requested capabilities/lifecycle before selecting it, or document the intentional override. |
| Model capability selection | Tool/json/reasoning/long-context/coding capability selection; OpenRouter catalog fallback (`model-resolver.ts`) | **Sound** | High / medium | Prove with live disposable-provider campaign; do not infer health from static defaults. |
| Catalog freshness | Dynamic catalog refresh, usable-model filtering, stale environment override ignored (`dynamic-catalog.ts`, `model-resolver.ts`) | **Sound** | High / medium | Monitor refresh failure and last-known-good age operationally. |
| Provider lifecycle | Credential hash only, health/reason/capability state, generation/revision, LKG degradation (`provider-lifecycle.ts`) | **Sound** | High / medium | Add malformed-key and concurrent refresh tests. |
| Retry/fallback/timeouts | Provider classification plus bounded fallback/retry; one request-owned ledger across model/provider/tool/recovery/planner work (`openai-compatible-client.ts`, `execution-ledger.ts`) | **Sound** | High / medium | Confirm real upstream retry-after and abort behavior with credentials. |
| Context health | Strict context schema and serializer distinguish not-requested, empty, unavailable, load-failed, stale, and truncated states (`context-contract.ts`, `context-serializer.ts`, `context-loader.ts`) | **Sound** | High / medium | Add an integration assertion that each state survives to every public projection. |
| Context execution admission | `contextManifestAllowsExecution` checks only `scanCompleteness === "COMPLETE"` (`context-manifest.ts`) | **Potential risk** | Medium / medium | Require validated manifest identity, revision, source root, and scan correlation at the admission boundary. |
| Context budget | Admission records per-slice decisions, but project and expanded graph are always admitted and remaining budget is clamped at zero (`context-runtime/context-admission.ts`) | **Potential risk** | Medium / high | Surface `budgetExceeded` and bound or explicitly reserve non-negotiable slices. |
| Context cache freshness | Cache key includes project/sections/plan hash; invalidation/reconnect exists but key lacks revision/manifest identity (`context-cache-manager.ts`, `context-builder.ts`) | **Potential risk** | Low / medium | Bind cached contexts to revision/manifest fingerprint or perform identity validation on hit. |
| Context link fidelity | Links are bounded and path-filtered, but `buildContextLinks` defaults links to ADMIT/fresh before final admission/lifetime (`context-links.ts`, `context-builder.ts`) | **Potential risk** | Low / medium | Project final slice decision/freshness into links or omit links for deferred/archived data. |
| Tool manifest | Full static server-owned manifest; provider/root/mode gates; unknown/not-in-manifest rejection (`tool-policy.ts`) | **Sound** | Critical / low | Keep full-manifest validation even when iteration exposure is narrowed. |
| Write/validation authorization | Post-model authorization and execution recheck; file/root containment and server-owned profiles (`tool-policy.ts`, `tool-execution-engine.ts`, `file-tools.ts`, `execution-kernel.ts`) | **Potential risk** | High / medium | Make approved path/profile manifests mandatory for write/validation/execution, not optional. |
| Prompt injection boundary | `formatUntrustedContent` labels and bounds data; tests prove hostile text cannot select a write/profile (`untrusted-content.ts`, `untrusted-content.test.ts`) | **Sound with integration gap** | High / low-medium | Enforce the envelope at tool-message construction and add a full tool-output-to-prompt test. |
| Analysis evidence correlation | Operation/project/revision/root/provenance checks; stale and cross-operation results rejected (`tools/analysis-tools.ts`, `analysis-tools.test.ts`) | **Sound** | Critical / low | Preserve server-owned runner binding; consider stronger artifact fingerprint binding. |
| Evidence gates | Complete reads, source scope, retained-read lineage, deterministic forensic contract, incomplete/cancelled terminal handling (`tool-execution-engine.ts`, `evidence-integrity.ts`, `forensic-output-guard.ts`, `forensic-recovery.ts`) | **Sound** | Critical / low | Keep model narrative separate from server-owned verification. |
| Public redaction | Ledger projection, history/export allowlists, operation-evidence redaction, credential AES-GCM with last-four display (`execution-ledger.ts`, `chat.ts`, `operation-evidence.ts`, `credentials-crypto.ts`) | **Sound except status defect** | Critical / medium | Fix raw status `terminalReason` and add adversarial endpoint tests. |
| Durable state | Unique user/idempotency key; leases, heartbeat, owner fences, monotonic checkpoint version, recovery revision binding (`ai_executions.ts`, `ai-execution-state.ts`) | **Sound by design** | Critical / medium | Add DB-backed concurrency tests and verify stale-worker reaping cadence. |
| Idempotency semantics | Unique key race is handled, but request equivalence is not fully compared (`ai-execution-state.ts:createAiExecution`) | **Potential risk / product decision** | Medium / medium | Decide whether same key means byte-equivalent request or logical resume; store/compare canonical request hash if equivalent. |
| Cancellation/recovery | Abort signal propagation, cancellation-aware finalize, paused/failed recovery, stale revision rejection (`task-execution-service.ts`, `chat.ts`) | **Sound with test gap** | Critical / medium | Exercise lease expiry and cancellation-vs-finalize races against a real DB fixture. |
| Event evidence correlation | `operation-evidence` queries by operation/correlation; some analysis/review event inserts omit correlation IDs (`operation-evidence.ts`, `analysis.ts`) | **Potential risk** | Medium / low-medium | Bind correlation IDs in every analysis/review event and test export completeness. |
| JSON/SSE/history parity | Strong deterministic parity/redaction fixtures for context provenance, cancellation, failed quality, history/export (`chat-sse.test.ts`, stream integration tests) | **Sound with contract drift gap** | High / medium | Make SSE a runtime-discriminated schema or generate it from a shared contract. |
| SSE client safety | Hand-maintained event union; parser casts arbitrary JSON and dispatches by `event.type`; route is OpenAPI-exempt (`use-ai-chat-stream.ts`, `openapi.yaml`, `ai-route-parity.test.ts`) | **Potential risk** | Medium / medium | Validate every public event at the client/API boundary and remove or justify the exemption. |
| Dashboard terminal display | Dashboard renders `execution.error`/`terminalReason`; operator recovery UI uses text nodes, but server projection must still be trusted (`AiChat.tsx`, `ProviderRecoveryCard.tsx`) | **Potential risk** | High / medium | Sanitize/bound terminal reason server-side and allowlist recovery action/correlation fields. |
| Release coverage | API/fixture contract checks are extensive; Dashboard preview contract is blocking only with `enablePreview: true` (`ai-release-quality-gate.ts`) | **Test/release gap** | Medium-high / high | Make the deterministic Dashboard journey mandatory in release CI; keep providers opt-in. |

## 4. Detailed findings

### F-01 — Raw terminal diagnostics cross the execution status boundary

- **Classification:** Potential security/contract defect.
- **Severity:** High.
- **Impact:** Provider, worker, path, or checkpoint diagnostics can be returned
  to an authenticated API consumer and rendered in the Dashboard. This can
  expose implementation details or sensitive runtime text and violates the
  documented public projection boundary.
- **Likelihood:** Medium; it depends on an error/checkpoint detail reaching the
  row, which is expected on failures.
- **Evidence:** `artifacts/api-server/src/routes/ai/chat.ts`, handler
  `GET /ai/executions/:executionId`, assigns
  `terminalReason: execution.error ?? checkpointRecord.detail` before the
  sanitized checkpoint. The same response comments that provider/worker errors
  are server-only. `artifacts/dashboard/src/pages/AiChat.tsx` renders
  `execution.terminalReason` directly.
- **Recommendation:** Return a stable allowlisted terminal code/message, using
  the same redaction and bounded projection as history/audit export. Add tests
  containing absolute paths, provider response bodies, URLs, credentials-like
  strings, and oversized diagnostics.
- **Acceptance:** No raw `execution.error`, `checkpoint.detail`, provider
  message, absolute path, or secret-like text appears in status JSON, SSE,
  history, or Dashboard rendering.

### F-02 — Approval constraints are optional at the authorization helper

- **Classification:** Potential authorization-scope defect.
- **Severity:** High.
- **Impact:** `authorizeToolInvocation` checks a write path only when
  `approvedFilePaths` is supplied, and checks a validation profile only when
  `approvedValidationProfiles` is supplied. If a future call site supplies
  `APPROVED` but omits the relevant manifest, the model can select any
  root-contained write path or any server-known validation profile.
- **Likelihood:** Medium; current execution paths may supply constraints, but
  the helper contract does not make the invariant mandatory.
- **Evidence:** `lib/ai-orchestrator/src/tool-policy.ts`, function
  `authorizeToolInvocation`, especially the conditional checks around
  `approvedFilePaths` and `approvedValidationProfiles`.
- **Recommendation:** Require non-empty server-owned manifests for every
  write, validation, browser-validation, and command execution authorization;
  reject missing manifests. Add negative tests for `APPROVED` plus omitted,
  empty, and mismatched constraints.
- **Acceptance:** No write/validation/execution tool can return `allowed: true`
  without the exact server-owned scope/profile manifest required by its tool
  category.

### F-03 — Context execution admission is weaker than context identity

- **Classification:** Potential evidence-integrity risk.
- **Severity:** Medium.
- **Impact:** A `COMPLETE` context manifest can pass the generic execution
  admission predicate without the predicate itself checking expected project
  revision, repository manifest, source root, scan correlation, or scanner
  version. A stale or malformed persisted context could therefore be admitted
  if a caller does not perform a stronger check first.
- **Likelihood:** Medium; callers may already match elsewhere, but the helper
  is reusable and fail-closed admission is not universal by construction.
- **Evidence:** `lib/ai-orchestrator/src/context-manifest.ts`,
  `contextManifestMatches` versus `contextManifestAllowsExecution`.
  `context-loader.ts` also has a compatibility path that casts a persisted
  repository manifest.
- **Recommendation:** Make the execution admission API require an expected
  identity and parse `RepositoryRevisionManifestSchema`; reject missing or
  malformed identity rather than relying on caller discipline.
- **Acceptance:** A context from another revision, source root, correlation,
  scanner version, or malformed manifest cannot enter an execution prompt or
  evidence gate.

### F-04 — Context admission can exceed its declared budget

- **Classification:** Reliability/operability risk.
- **Severity:** Medium.
- **Impact:** `project` and expanded graph slices are always admitted while the
  remaining budget is clamped at zero. The result records slice decisions but
  not an explicit over-budget state. Large contexts can therefore increase
  provider rejection, latency, fallback frequency, or truncation without a
  clear operator explanation.
- **Likelihood:** High by design for large projects and expanded graph mode.
- **Evidence:** `lib/ai-orchestrator/src/context-runtime/context-admission.ts`,
  `decideSlice` and `runAdmission`.
- **Recommendation:** Reserve explicit minimum budgets, expose
  `budgetExceeded`/`requiredSlicesOverBudget`, and bound expanded/project data
  or fail with a safe narrow-request result.
- **Acceptance:** Every context response either fits its declared budget or
  exposes a machine-readable, user-safe over-budget state with the affected
  slices.

### F-05 — Context cache identity does not include repository revision

- **Classification:** Potential freshness risk.
- **Severity:** Low to medium.
- **Impact:** A cache key based on project, requested sections, and plan hash
  can retain data across a repository revision unless invalidation works
  perfectly. Rebinding a new operation identity does not make the cached
  content current.
- **Likelihood:** Medium; invalidation/reconnect exists, but cache identity is
  not itself revision-bound and invalidation may be delayed or process-local.
- **Evidence:** `lib/ai-orchestrator/src/context-builder.ts`,
  `buildContextCacheKey` usage; `context-cache-manager.ts` invalidation.
- **Recommendation:** Include a repository/scan manifest fingerprint in the
  key or perform a cheap current-revision check on cache hit.
- **Acceptance:** A cache hit from an older revision is rejected or explicitly
  marked stale before prompt/evidence use.

### F-06 — Context links can report final states inaccurately

- **Classification:** Provenance presentation risk.
- **Severity:** Low.
- **Impact:** `buildContextLinks` defaults a link to `ADMIT` and `fresh` before
  final admission/lifetime policy is applied. A link can therefore describe a
  source slice as admitted/fresh while the corresponding context slice is
  referenced, deferred, or aged.
- **Likelihood:** Medium.
- **Evidence:** `lib/ai-orchestrator/src/context-links.ts:link` and
  `context-builder.ts:assembleContext`.
- **Recommendation:** Build links from final slice state or attach a final
  status projection after admission/lifetime.
- **Acceptance:** Every public context link agrees with the final slice
  decision, freshness, and lifetime status.

### F-07 — Analysis/review events can be absent from operation evidence

- **Classification:** Evidence completeness risk.
- **Severity:** Medium.
- **Impact:** `loadOperationEvidence` correlates events by operation ID. Some
  analysis/review event insertions do not include the correlation ID used by
  that loader, so a successful run can export a missing-events gap or an
  incomplete timeline.
- **Likelihood:** Low to medium.
- **Evidence:** `artifacts/api-server/src/lib/operation-evidence.ts`,
  `loadOperationEvidence`; analysis/review event writes in
  `artifacts/api-server/src/routes/ai/analysis.ts`.
- **Recommendation:** Require correlation ID in the event-write helper for all
  AI operations and add a successful analysis/review audit-export assertion.
- **Acceptance:** A completed analysis/review run has a correlated event
  timeline or is explicitly classified as incomplete rather than silently
  appearing complete.

### F-08 — SSE has two manually maintained contract sources

- **Classification:** API/client contract drift risk.
- **Severity:** Medium.
- **Impact:** The client event union and parser can accept an arbitrary JSON
  shape after checking only `event.type`; the OpenAPI stream route is
  explicitly excluded from route parity. A server event change can therefore
  render incorrectly or lose terminal/provenance fields without a generated
  contract failure.
- **Likelihood:** Medium.
- **Evidence:** `lib/api-client-react/src/use-ai-chat-stream.ts`, event parser
  and union; `lib/api-spec/openapi.yaml` stream route; exemption in
  `artifacts/api-server/src/routes/ai-route-parity.test.ts`.
- **Recommendation:** Define a shared discriminated event schema, validate at
  the API/client boundary, and generate or fixture-test the event matrix.
- **Acceptance:** Every public event type has runtime validation and a
  fixture covering required fields, redaction, terminal state, and reconnect.

### F-09 — Dashboard recovery fields are not allowlisted at component boundary

- **Classification:** Defense-in-depth/test gap.
- **Severity:** Medium.
- **Impact:** React text rendering prevents HTML execution, but arbitrary,
  unbounded `operatorAction` and `correlationId` values can still create
  misleading UI, long-content abuse, or unsafe operational guidance if a
  route projection regresses.
- **Likelihood:** Low to medium.
- **Evidence:** `artifacts/dashboard/src/components/ProviderRecoveryCard.tsx`,
  `operatorAction` and `correlationId` are accepted as arbitrary strings;
  `AiChat.tsx` also uses availability suffix data.
- **Recommendation:** Make the API schema a closed set of action/reason codes
  and render only allowlisted templates/correlation identifiers. Keep a
  component test for malicious paths, URLs, secrets, and long values.
- **Acceptance:** Dashboard recovery copy is generated from stable codes and
  bounded identifiers only.

### F-10 — Default release validation can omit the Dashboard AI journey

- **Classification:** Release-process/test gap.
- **Severity:** Medium to high.
- **Impact:** API and deterministic fixture checks can pass while the actual
  authenticated Dashboard history, terminal, provenance, or audit-preview
  rendering is broken.
- **Likelihood:** High unless CI separately enables preview.
- **Evidence:** `artifacts/api-server/src/lib/ai-release-quality-gate.ts`,
  `getAiReleaseChecks` enables `dashboard-preview-contract` only when
  `enablePreview === true`; its test asserts preview is disabled by default.
- **Recommendation:** Make the deterministic Dashboard journey blocking in
  release CI while keeping live provider campaigns opt-in.
- **Acceptance:** A release cannot pass the AI gate without the fixture-backed
  Dashboard journey, including history selection, status reload, cancellation,
  proof panel, redacted preview, and export.

### F-11 — Task lifecycle race coverage is incomplete

- **Classification:** Test gap.
- **Severity:** High for reliability.
- **Impact:** Static ownership fences look correct, but a regression in lease
  expiry, heartbeat failure, cancellation winning finalize, or stale worker
  completion could publish the wrong terminal state.
- **Likelihood:** Medium.
- **Evidence:** `task-execution-service.ts` contains the ownership/cancellation
  logic; inspected tests primarily cover bounded receipts rather than a
  DB-backed end-to-end lifecycle race.
- **Recommendation:** Add isolated PostgreSQL integration fixtures for:
  lease loss during provider work, heartbeat failure, cancel/finalize race,
  duplicate idempotency requests, checkpoint version collision, and recovery
  against a changed revision.
- **Acceptance:** Stale workers cannot write final success, and cancelled or
  uncertain operations remain visibly incomplete after reconnect/reload.

### F-12 — Idempotency key semantics are underspecified

- **Classification:** Product/contract decision.
- **Severity:** Medium.
- **Impact:** The schema guarantees one `(userId, idempotencyKey)` row, but
  request identity is not necessarily byte-equivalent across retries. A client
  reusing a key for changed objective/message/revision could receive the old
  execution, or the system could intentionally treat it as a logical resume.
- **Likelihood:** Medium.
- **Evidence:** `lib/db/src/schema/ai_executions.ts` unique index and
  `ai-execution-state.ts:createAiExecution`.
- **Recommendation:** Choose and document one contract. If keys represent
  request equivalence, persist and compare a canonical request hash. If they
  represent a logical operation, expose that explicitly and bind all mutable
  fields to the durable operation.
- **Acceptance:** A changed request either deterministically returns a
  conflict or is explicitly accepted as the same logical operation.

### F-13 — Dead duplicate task route implementation increases maintenance risk

- **Classification:** Code-quality/operational risk.
- **Severity:** Medium.
- **Impact:** `artifacts/api-server/src/routes/ai/tasks.ts` returns the new
  lifecycle response around line 169, leaving a second large implementation
  unreachable below it. The two paths can drift in persistence, error, and
  recovery semantics and mislead future audits.
- **Likelihood:** Medium.
- **Recommendation:** Remove or clearly isolate the unreachable implementation
  in a separate historical note after confirming no generated import depends
  on it. This is a follow-up change, not part of this report.
- **Acceptance:** One reachable task route implementation owns the contract,
  and static checks fail if a second unreachable route handler is reintroduced.

### F-14 — Provider key validation intentionally performs a live call

- **Classification:** Product/operations decision.
- **Severity:** Medium.
- **Impact:** Saving a provider key calls a provider with a one-token probe.
  Transient errors are treated as valid so a connectivity problem does not
  prevent saving. This is reasonable product behavior but means provider-free
  validation cannot prove key/model readiness.
- **Likelihood:** Certain when a user saves a key.
- **Evidence:** `lib/ai-orchestrator/src/agent-complete.ts:probeProviderKey`
  and `validateProviderKey`; provider route validation in
  `artifacts/api-server/src/routes/ai/providers.ts`.
- **Recommendation:** Keep live validation explicitly opt-in for release
  checks, and define whether the UI should distinguish “saved but unchecked”
  from “verified.” Do not silently call live providers from provider-free
  tests.
- **Acceptance:** Provider-free checks never make upstream calls; live checks
  have disposable credentials, bounded duration, and redacted receipts.

## 5. What is proven, and what is not

### Proven by static inspection and deterministic fixtures

- The intended API ownership boundaries and user-scoped execution lookup.
- The presence of a unified `TurnIntent` and frozen execution-plan decision.
- Provider registry/strategy separation and catalog-driven OpenRouter model
  resolution.
- Request-owned bounds for model, provider, tool, planner, synthesis,
  recovery, and hierarchical work.
- Lexical/realpath file containment, deleted-root handling, symlink checks,
  process root/cwd revalidation, timeout, and cancellation paths.
- Server-owned tool manifest and explicit authorization reasons.
- Untrusted-content formatting and deterministic prompt-injection tests at the
  inspected unit boundary.
- Analysis correlation checks for operation, project, revision, root
  availability, and evidence provenance.
- Forensic complete-read/source-scope/cancellation gates.
- Durable schema fields, owner/lease/checkpoint/recovery code paths, and
  append-only proposal/apply structures.
- Redacted history/export/operation-evidence projections and several JSON/SSE
  parity cases.
- Dashboard rendering paths for terminal, evidence, cancellation, proof, and
  redacted audit preview.

### Not proven without provider credentials or controlled live execution

- Any provider's current model availability, quota, billing state, or
  capability behavior.
- Actual OpenRouter dynamic catalog freshness and free-model fallback under
  real model retirement or request-shape rejection.
- Gemini, DeepSeek, Groq, or OpenRouter response-shape compatibility against
  the current upstream APIs.
- Real retry-after values, network timeout behavior, upstream abort
  cooperation, or provider fallback latency.
- SSE framing through the Replit proxy/deployment path, reconnect timing, or
  browser `EventSource` behavior in production.
- Live Clerk/session/project ownership behavior.
- Database contention, lease expiry, heartbeat loss, worker restart, and
  cancellation-vs-finalize races unless the relevant integration suites are
  executed against an isolated database.
- Production release gate outcomes, operator alert delivery, and actual
  Dashboard performance.

### Fixture-only limitations

The inspected deterministic fixtures are valuable safety contracts, but they
mostly exercise controlled payloads and mocked routes. They do not establish:

- that every future route call site supplies mandatory approval manifests;
- that every analysis/review event carries the expected correlation ID;
- that every SSE event permutation is runtime-schema-valid;
- that the raw execution status route remains redacted under adversarial
  checkpoint/error values; or
- that provider/tool/database races behave correctly under real concurrency.

## 6. Prioritized backlog

### P0 — security and safety before expanding execution

1. **Close the raw terminal-diagnostic leak.**
   - Files: `artifacts/api-server/src/routes/ai/chat.ts`,
     `artifacts/dashboard/src/pages/AiChat.tsx`,
     `artifacts/api-server/src/routes/ai/chat-sse.test.ts`.
   - Done: status, SSE, history, and export expose only bounded allowlisted
     terminal codes/messages; adversarial diagnostics never cross the boundary.
2. **Make approval manifests mandatory for state-changing tools.**
   - Files: `lib/ai-orchestrator/src/tool-policy.ts`,
     `tool-execution-engine.ts`, execution-tool tests.
   - Done: writes, validation, browser validation, and commands require exact
     server-owned paths/profiles; missing constraints fail closed.
3. **Bind execution admission to validated context identity.**
   - Files: `context-manifest.ts`, `context-loader.ts`,
     `context-builder.ts`, context contract tests.
   - Done: revision/source-root/manifest/correlation/scanner identity is
     parsed and matched before prompt/evidence admission.

### P1 — reliability and evidence correctness

4. **Make event correlation complete for analysis/review.**
   - Files: `artifacts/api-server/src/routes/ai/analysis.ts`,
     `operation-evidence.ts`, analysis route tests.
   - Done: successful runs have complete correlated evidence or an explicit
     incomplete verdict.
5. **Add DB-backed lifecycle race coverage.**
   - Files: `ai-execution-state.test.ts`,
     `task-execution-service.test.ts`, job/recovery integration fixtures.
   - Done: stale worker, heartbeat loss, cancellation/finalize, idempotency,
     monotonic checkpoint, and revision-recovery cases are blocking tests.
6. **Make context budget overflow explicit.**
   - Files: `context-runtime/context-admission.ts`,
     `context-builder.ts`, context serialization tests.
   - Done: non-negotiable slices are bounded/reserved and over-budget state is
     visible to the operator without exposing internal diagnostics.
7. **Bind context cache to revision identity.**
   - Files: `context-cache-manager.ts`, `context-builder.ts`.
   - Done: old-revision cache hits cannot enter a new execution as fresh.

### P2 — operator and API contract improvements

8. **Unify and runtime-validate SSE contracts.**
   - Files: `lib/api-client-react/src/use-ai-chat-stream.ts`,
     `lib/api-spec/openapi.yaml`, `ai-route-parity.test.ts`,
     `chat-sse.test.ts`.
   - Done: every event is validated and fixture-covered; any OpenAPI
     exemption is intentional and documented.
9. **Require the Dashboard journey in release validation.**
   - Files: `ai-release-quality-gate.ts`, release scripts, authenticated
     Dashboard journey tests.
   - Done: default blocking validation covers history, reconnect, terminal
     state, evidence, redaction, preview, and export.
10. **Allowlist provider recovery UI fields.**
    - Files: `ProviderRecoveryCard.tsx`, `AiChat.tsx`, component tests.
    - Done: action text is selected by stable reason code and identifiers are
      bounded.

### P3 — future product and maintenance work

11. **Decide and document idempotency-key semantics.**
    - Files: `ai-executions.ts`, `ai-execution-state.ts`, API contract docs.
12. **Remove unreachable duplicate task route implementation.**
    - File: `artifacts/api-server/src/routes/ai/tasks.ts`.
13. **Define provider readiness UX.**
    - Files: `providers.ts`, provider lifecycle projection, Dashboard provider
      settings/recovery UI.
    - Distinguish saved, unchecked, ready, degraded, and unavailable without
      implying that a static audit proves live AI success.
14. **Add stronger artifact identity to analysis evidence.**
    - Files: `tools/analysis-tools.ts`, server-owned analysis runners,
      `operation-evidence.ts`.
    - Bind evidence provenance to persisted artifact/revision fingerprints in
      addition to matching string correlation fields.

## 7. Recommended acceptance gates for subsequent work

Before adding another provider or expanding execution scope, require:

1. P0 findings closed with adversarial tests.
2. JSON, SSE, history, status, and audit export to share one public provenance
   and redaction projection.
3. A cancelled run to remain incomplete after reconnect and reload.
4. A stale revision or cross-operation analysis result to be rejected.
5. A model-proposed write or validation profile without a matching
   server-owned manifest to be rejected.
6. A stale worker to be unable to publish final success after lease loss.
7. The default release gate to execute the deterministic authenticated
   Dashboard journey.
8. A separate, explicitly opt-in live campaign to prove each provider's
   current model and request-shape compatibility.

The final gate must distinguish:

- **PROVEN:** server-owned evidence and acceptance checks passed;
- **INCOMPLETE:** evidence, provider response, or lifecycle proof is missing;
- **NOT VERIFIED LIVE:** static/fixture checks passed but no credentialed
  upstream request was made.

No statement in this report should be interpreted as a live-provider success
claim.