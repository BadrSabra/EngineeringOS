# Replit Agent parity gap assessment

**Assessment date:** 2026-08-25  
**Comparison target:** observable engineering-agent outcomes, not proprietary Replit
internals  
**Product boundary:** EngineeringOS is a specialized, evidence-first engineering
console. This document does not recommend removing its approval, isolation, or
human-review gates.

## 1. Comparison contract

The unit of comparison is what a user can observe:

1. understand a project;
2. answer with grounded context;
3. plan a change;
4. make a bounded change;
5. validate it;
6. recover from interruption, conflict, or failure; and
7. deliver it safely.

Provider and model selection are implementation details unless they change one
of those outcomes. “Parity” below means parity with the relevant workflow, not
feature-for-feature parity with a hosted IDE.

The evidence baseline is [`actual-capability-baseline-v1.md`](actual-capability-baseline-v1.md).
It is a source-and-provider-free assessment, not a production claim: it records
no end-to-end pass, five selected API-suite failures, and a benchmark gate with
`qualityEligible: false` and `rolloutAllowed: false` ([baseline §2](actual-capability-baseline-v1.md#2-executive-result),
[§7](actual-capability-baseline-v1.md#7-provider-free-verification-matrix)).

### Status vocabulary

- **Parity** — the relevant outcome exists and its observable contract is
  covered at the available evidence level.
- **Specialized stronger** — the product intentionally exceeds a typical
  general Agent in safety, provenance, approval, or delivery controls.
- **Partial** — the path exists, but an important transition, prerequisite, or
  integration is unproven.
- **Gap** — the outcome is missing, or a tested defect prevents a reliable user
  outcome. A provider outage alone is not classified as a missing capability.
- **Not a gap** — an intentional product boundary, such as rejecting arbitrary
  model-provided shell commands.

## 2. Parity matrix

| Observable outcome | Current EngineeringOS behavior and evidence | Assessment | Failure mode / user experience |
|---|---|---|---|
| Project understanding | Discovery/import has durable, owner-scoped materialization and the dashboard wizard; source discovery, scan, and import are separate stages ([discovery route](../artifacts/api-server/src/routes/discovery.ts), [baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Partial** | A selected durable Git fixture returned HTTP 400 instead of expected 202. A user can be blocked before project context exists. This is a fixture/integration defect, not evidence that discovery is absent. |
| Grounded ordinary chat | Chat and SSE routes build context, classify intent, persist history, and expose read/list/search tools. `chat-agent.ts` records actual tool sources, caches repeated calls, and bounds iterations/calls ([chat agent](../lib/ai-orchestrator/src/agents/chat-agent.ts#L4-L40)). | **Specialized stronger, operationally partial** | Provenance and redaction are stronger than a speed-first chat UX, but AI requires a configured provider and no live chat journey was run ([baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). |
| Broad multi-file analysis | Hierarchical execution gives subtasks bounded loops, disjoint write scopes, preserved partial results, and a no-tools synthesis pass ([hierarchical executor](../lib/ai-orchestrator/src/agents/hierarchical-executor.ts#L4-L22)). | **Specialized stronger** | Broad analysis is deliberately bounded and evidence-checked. Recursive nesting and per-subquery SSE are explicitly out of scope ([same source](../lib/ai-orchestrator/src/agents/hierarchical-executor.ts#L19-L22)); long or highly interactive investigations may feel less fluid than a general Agent. |
| Structured scan/review | Analyze and review each have JSON and stream endpoints, context construction, fallback, parse/error handling, audit/event persistence ([analysis routes](../artifacts/api-server/src/routes/ai/analysis.ts#L174-L583)). | **Partial** | Provider prerequisite blocks live execution; no authenticated E2E result proves the full stream-to-history experience. |
| Conversational planning | Implementation planning requires a verified manifest and source excerpts and returns an explicit pending-approval/not-authorized outcome when grounding is missing ([chat planning guards](../artifacts/api-server/src/routes/ai/chat.ts#L605-L738); [baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Specialized stronger** | The safe plan boundary is stronger than implicit “agent edits.” The missing proof is provider-backed generation and browser confirmation, not the authorization model. |
| Bounded code changes | `write_file` queues pending changes; approval and proposal endpoints are distinct, and the API rechecks project context before authorizing writes ([chat agent](../lib/ai-orchestrator/src/agents/chat-agent.ts#L38-L42); [chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L4960-L5884)). | **Specialized stronger, operationally partial** | Users get a safe proposal rather than an immediate mutation. The complete plan → approval → validation → apply browser path was not run. |
| Candidate validation | Server-owned validation profiles, isolated workspaces, scope checks, redacted public receipts, and repair runners exist ([repair validation](../artifacts/api-server/src/lib/ai-repair-validation.ts#L113-L441)). | **Specialized stronger, unreliable** | Two selected isolated validation tests timed out at 120 seconds. Until timeout behavior is bounded and green, a user cannot reliably distinguish slow validation from a stuck run. |
| Apply/promotion | Delivery workspace captures revisions and hashes; apply checks containment, duplicates, base/hash conflicts, proposal state, receipt, and journal before atomic promotion ([delivery workspace](../artifacts/api-server/src/lib/delivery-workspace.ts#L28-L88); [baseline §5](actual-capability-baseline-v1.md#5-change-delivery-trace)). | **Specialized stronger** | Safety gates are stronger than a direct-edit Agent. Operational promotion remains unproven because the isolated validation fixtures timed out. |
| Conflict recovery | Rebase and apply paths hash the base, rebase hunks, preserve conflict metadata, and expose recovery/discard/resume-validation routes ([chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L5274-L5470)). | **Specialized stronger, E2E partial** | A changed workspace can block promotion safely and offer a retry path. No complete user journey has demonstrated successful rebase and retry. |
| Long-running task execution | Task execution uses ownership, status/rate limits, task logs/events, durable lifecycle helpers, and explicit concurrent-state responses ([task route](../artifacts/api-server/src/routes/ai/tasks.ts#L40-L140); [task agent](../lib/ai-orchestrator/src/agents/task-agent.ts#L27-L65)). | **Partial** | Real provider execution was not run; the selected suite also exposed out-of-order active-task-state persistence. Users may receive a conflict/refresh instruction rather than a completed task. |
| Workflow execution | AI orchestration has a route; the broader workflow API supports start/stop/advance/fail/retry/rollback ([workflow route](../artifacts/api-server/src/routes/ai/workflows.ts#L47-L117)). | **Partial** | Workflow mechanics are present, but provider-backed orchestration and terminal E2E states remain unproven. |
| Cancellation, resume, and restart recovery | Durable execution rows, leases, checkpoints, hashed resume tokens, cancellation terminalization, ownership fences, and recovery endpoints exist ([execution state](../artifacts/api-server/src/lib/ai-execution-state.ts#L8-L205); [chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L4632-L4700)). | **Specialized stronger, unreliable** | The selected streamed forensic-cancellation fixture aborted, and no reload-after-restart browser journey passed. A user can see an incomplete result even when retained evidence exists; this is safer than falsely claiming success but needs reliable transport handling. |
| Validation/evidence UX | Flight Deck renders operation, checkpoint, evidence, and validation state; Mission Control renders recovery actions and completeness; chat exposes validation attempts and proof details ([Flight Deck](../artifacts/dashboard/src/pages/FlightDeck.tsx#L1-L180); [Mission Control](../artifacts/dashboard/src/pages/MissionControl.tsx#L1-L225); [AiChat](../artifacts/dashboard/src/pages/AiChat.tsx#L2743-L2795)). | **Specialized stronger, browser partial** | The UI can explain blocked, incomplete, and unverified states rather than flattening them to success. No authenticated browser journey validated SSE rendering and refresh behavior. |
| Git delivery | Status/log/commit/push/export endpoints are separate and protected by project access/write middleware ([Git routes](../artifacts/api-server/src/routes/git.ts#L180-L786)). | **Partial** | Commit/push require a configured remote/credential and were not live-tested. This is an environment prerequisite, not a missing Git capability. |
| Audit/export | Operation evidence projects allowlisted events, receipts, revisions, proposals, commit, and push data; audit export is exposed by API ([operation evidence](../artifacts/api-server/src/lib/operation-evidence.ts#L118-L282); [chat audit route](../artifacts/api-server/src/routes/ai/chat.ts#L4481-L4500)). | **Parity for scoped product goal** | It is intentionally an audit artifact, not an IDE transcript or arbitrary workspace export. No download smoke check was run. |
| Provider resilience | OpenRouter has capability-aware fallback, dynamic free-model filtering, circuit breaking, error classification, and reliability tests ([model resolver](../lib/ai-orchestrator/src/openrouter/model-resolver.ts#L112-L187); [dynamic catalog](../lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts#L77-L197); [reliability tests](../lib/ai-orchestrator/src/__tests__/openrouter-reliability.test.ts#L1-L14)). | **In-progress hardening, not a parity gap** | Catalog refresh, live availability, and fixture/capability guards remain current variables. Do not claim production provider parity until the existing OpenRouter stabilization and catalog-diagnostics work are accepted. |
| Arbitrary shell execution | Tool policy accepts server-owned command profiles; the model cannot provide shell text or arbitrary argv ([baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Not a gap; intentional safer difference** | Some Replit-like workflows may be faster with broad shell access, but adding it would violate the product safety boundary and is a non-goal. |

## 3. Gap classification and priority

The highest-impact problems are reliability and proof gaps in an otherwise
implemented path. They must not be described as “the Agent cannot do X” when
the source provides X but the acceptance evidence is incomplete.

| Rank | Finding | Classification | User impact | Reliability / safety risk | Dependency |
|---|---|---|---|---|---|
| P0 | Provider-free contract and model resolution must remain deterministic; the benchmark gate currently reports `broken` where the required scenario expects `fixed`. | Test/release gate defect; existing capability not safely releasable | Blocks any production-ready claim | High: a false green could authorize bad behavior | Existing OpenRouter stabilization; coordinate with Task 12 rather than duplicating its benchmark scenarios |
| P0 | Isolated validation has two 120-second timeouts. | Existing-but-unreliable behavior / environment prerequisite | Blocks apply and makes repair state ambiguous | High: delivery cannot be proven | Before promotion E2E |
| P0 | Selected API suite is not green: active-task ordering, streamed cancellation, Git discovery fixture, and validation timeouts. | Reliability defects, not missing product features | Recovery and task users receive inconsistent outcomes | High for terminal-state integrity | Before production-ready claim |
| P1 | No authenticated provider-configured browser/API journey has completed the critical path. | Test/observability gap | Operators cannot trust the console’s end-to-end UX | High: code-backed safety may not survive integration | Requires controlled provider, Clerk browser state, and isolated project |
| P1 | Provider/catalog diagnostics need a clear operator-facing failure state and acceptance contract. | Poor diagnostics / reliability hardening | Users may see generic provider failure instead of actionable model/catalog guidance | Medium; prevents unsafe retries and misclassification | Depends on existing catalog implementation; do not replace it |
| P1 | Recovery transport and refresh behavior need a green cancellation/reconnect/restart journey. | Existing-but-unreliable behavior | Interrupted work may look lost or remain incomplete after reconnect | High for user trust and idempotency | After API cancellation/order fixes |
| P1 | Discovery durable Git fixture must match its documented async contract. | Test/fixture defect | New users can fail before importing a project | Medium | Before discovery smoke gate |
| P2 | Browser UX should make the critical path and blocked reasons more explicit. | Incomplete UX | Users may not know whether to approve, rerun validation, rebase, or start over | Medium, mostly usability | After P0/P1 correctness |
| P3 | Broaden general-Agent conveniences: richer recursive investigation, per-subtask streaming, more automatic environment setup. | Optional parity expansion | Improves speed and breadth, not correctness of the specialized product | Low relative to release blockers; may weaken boundedness | Only after production-ready specialized gates |

## 4. Actionable remediation roadmap

Each item has a bounded outcome. These are recommendations only; this task does
not implement them.

### Immediate fixes (P0)

#### R1 — Make the provider-free release gate truthful

- **Affected surfaces:** `package.json` release scripts; orchestrator benchmark
  fixtures and OpenRouter contract tests; existing Task 12 benchmark work.
- **Acceptance:** the required runtime-oracle scenario passes with the expected
  verdict; `pnpm run validate:ai-release`, orchestrator typecheck, benchmark
  baseline check, and API typecheck are green; rollout is blocked when any
  contract result is incomplete.
- **Non-goals:** no new benchmark scenario set, no live provider requirement,
  and no redefining Task 12’s scope.
- **Dependency/risk:** first gate; high release risk if skipped.

#### R2 — Bound and diagnose isolated validation

- **Affected surfaces:** `ai-repair-validation.ts`, registered command
  profiles, release validation fixtures.
- **Acceptance:** each validation attempt has a finite process/overall deadline,
  retains a redacted receipt, and ends as passed, failed, blocked, or unavailable
  rather than timing out the test harness; the two currently timing-out
  scenarios pass or produce an explicit audited block.
- **Non-goals:** no model-supplied commands, no weakening candidate/revision
  binding, and no bypass of validation for apply.
- **Dependency/risk:** required before promotion/apply E2E; high safety risk.

#### R3 — Repair terminal ordering and stream cancellation

- **Affected surfaces:** `ai-execution-state.ts`, chat route SSE lifecycle,
  task execution state persistence, cancellation/reconnect fixtures.
- **Acceptance:** out-of-order writes cannot overwrite newer task state;
  cancellation preserves collected evidence and terminalizes as incomplete;
  a browser/client reconnect receives the durable terminal state exactly once.
- **Non-goals:** no optimistic “success” after disconnect and no deletion of
  retained evidence.
- **Dependency/risk:** after R2’s bounded process behavior; high durability risk.

### Hardening (P1)

#### R4 — Run the controlled critical-path acceptance campaign

- **Affected surfaces:** API routes, dashboard `AiChat`, `FlightDeck`,
  `MissionControl`, discovery and Git routes.
- **Acceptance:** in a disposable authenticated project, capture pass/fail
  receipts for discovery → chat SSE → analyze/review → task/workflow terminal
  state → plan approval → isolated validation → apply → rebase conflict/retry
  → cancellation/restart reload → audit export → scoped commit/push.
- **Non-goals:** no production deployment, no broad live campaign, and no claim
  that a single passing fixture proves all providers.
- **Dependency/risk:** requires a controlled provider and browser runtime;
  highest evidence value after R1–R3.

#### R5 — Ship catalog/provider diagnostics

- **Affected surfaces:** `dynamic-catalog.ts`, OpenRouter resolver/strategy,
  API error projection, Mission Control/AiChat diagnostics.
- **Acceptance:** distinguish missing key, authentication, no compatible free
  model, stale/expired catalog, rate limit, quota, circuit-open, and provider
  outage; show a safe operator action and retain a correlation identifier.
- **Non-goals:** do not treat a failed refresh as proof that the provider has no
  models; do not expose keys or raw provider diagnostics to users; do not
  duplicate the existing fallback/circuit-breaker implementation.
- **Dependency/risk:** builds on the existing OpenRouter stabilization; medium
  reliability and UX risk.

#### R6 — Align discovery fixture and async contract

- **Affected surfaces:** discovery route/client contract and its durable Git
  fixture.
- **Acceptance:** the documented source-start response (202 where applicable)
  and subsequent session/summary/import states agree in route tests and one
  controlled smoke run; failures identify the source/session state.
- **Non-goals:** no new repository providers or import UX redesign.
- **Dependency/risk:** independent of provider AI; medium onboarding impact.

### UX improvements (P2)

#### R7 — Make next safe action explicit

- **Affected surfaces:** `AiChat.tsx`, `MissionControl.tsx`, `FlightDeck.tsx`.
- **Acceptance:** every blocked, conflicted, cancelled, unavailable, and
  retained-with-gaps state displays one safe next action (refresh, re-scan,
  re-approve, resume validation, rebase, discard, or manual review), with the
  operation/revision context.
- **Non-goals:** no automatic apply, silent retry, or removal of evidence
  warnings.
- **Dependency/risk:** after terminal states and receipts are reliable; medium
  usability impact.

### Optional Replit-like expansions (P3)

#### R8 — Add bounded breadth conveniences

- **Affected surfaces:** hierarchical executor and chat SSE/UI.
- **Acceptance:** optional recursive decomposition and/or per-subtask progress
  can be enabled with explicit budgets, cancellation, evidence lineage, and
  coverage validation; default behavior remains bounded and safe.
- **Non-goals:** no arbitrary shell execution, no removal of approval or
  candidate validation, and no attempt to reproduce proprietary Replit Agent
  internals.
- **Dependency/risk:** only after production-ready specialized acceptance;
  medium complexity with low immediate user value.

## 5. Release gates by maturity

| Maturity claim | Minimum pass evidence | Explicit limitations |
|---|---|---|
| Prototype | Typecheck; dashboard component/client contracts; deterministic truth-flow and benchmark structure; mocked route/component behavior. | Provider, browser, delivery, and recovery are not proven. Do not call this production-ready. |
| Usable internal tool | Prototype gates plus green provider-free API subset, green R1–R3 contracts, and one controlled authenticated journey covering chat or analysis and a persisted terminal result. | Git push, discovery breadth, and all delivery transitions may still be unproven. |
| Production-ready specialized Agent | All provider-free release gates green; no validation timeout or terminal-ordering defect; controlled campaign passes discovery, grounded chat, analysis/review, task/workflow, plan approval, candidate-bound validation, apply, conflict retry, cancellation/restart, evidence reload/export, and safe Git commit/push. Provider diagnostics are actionable, and benchmark rollout is allowed. | Still intentionally narrower than a general IDE Agent: server-owned commands, explicit approval, evidence verdicts, isolated promotion, and human review remain required. |
| Replit-like general workflow | Specialized gate plus repeatable broad project understanding and change delivery across supported project types/providers, bounded interactive progress, and documented environment setup/repair coverage. | This is an optional expansion, not the current product goal; it does not imply proprietary feature parity. |

Any gate that is unavailable because of provider credentials or a controlled
environment must be reported as **blocked**, not passed. The baseline’s eight
real-smoke requirements are the acceptance checklist, not evidence that those
capabilities are absent ([baseline §9](actual-capability-baseline-v1.md#9-capabilities-requiring-a-real-smoke-check)).

## 6. Final assessment

EngineeringOS already covers the core Agent workflow in source, and it is
stronger than a conventional fast Agent in approval, evidence lineage,
candidate isolation, revision binding, redaction, and auditability. The
remaining parity risk is not “build an Agent from scratch.” It is to make the
existing workflow operationally trustworthy:

1. keep the provider-free release and benchmark gate truthful;
2. eliminate validation timeouts and terminal-state ordering/cancellation
   defects;
3. prove the full path in a controlled authenticated campaign; and
4. expose actionable provider/catalog and recovery diagnostics.

Only after those gates pass should breadth and speed enhancements be considered.
The existing OpenRouter stabilization and catalog diagnostics work belongs in
that sequence, while the separate benchmark-fixture task remains the owner of
scenario coverage. No unrelated hosting, collaboration, billing, IDE, or
deployment feature is required for the current specialized-Agent claim.