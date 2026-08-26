# Replit Agent parity gap assessment

**Assessment date:** 2026-08-26
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
The latest provider-free release decision passed its enabled AI contracts
(9 passed, 0 blocking failures), and the deterministic runtime-oracle blocker
is closed. This is still not a production claim: preview and live-provider
checks are disabled, no authenticated end-to-end journey is recorded, and the
approved benchmark baseline retains `qualityEligible: false` and
`rolloutAllowed: false` ([baseline §2](actual-capability-baseline-v1.md#2-executive-result),
[§7](actual-capability-baseline-v1.md#7-provider-free-verification-matrix)).

### Decision summary

- **Can be relied on now:** the source-backed workflow, server-owned safety
  boundaries, source/candidate-bound release contracts, provider-free AI
  JSON/SSE/redaction contracts, bounded validation, recovery checks, and
  deterministic benchmark scenario coverage.
- **Needs more evidence:** authenticated provider-backed chat/analysis, the
  discovery async contract, browser reload/restart behavior, full approval →
  promotion, and a safe Git commit/push smoke. The last recorded live Git
  delivery proof prerequisite is still blocked.
- **Intentional difference:** EngineeringOS requires explicit approval,
  candidate isolation, server-owned command profiles, evidence verdicts, and
  human review instead of arbitrary model shell execution or implicit edits.

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
| Project understanding | Discovery/import has durable, owner-scoped materialization and the dashboard wizard; source discovery, scan, and import are separate stages ([discovery route](../artifacts/api-server/src/routes/discovery.ts), [baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Partial** | The documented async Git fixture contract still lacks a current controlled smoke proof. This is an onboarding evidence gap, not evidence that discovery is absent. |
| Grounded ordinary chat | Chat and SSE routes build context, classify intent, persist history, and expose read/list/search tools. `chat-agent.ts` records actual tool sources, caches repeated calls, and bounds iterations/calls ([chat agent](../lib/ai-orchestrator/src/agents/chat-agent.ts#L4-L40)). | **Specialized stronger, provider/browser partial** | Provider-free JSON/SSE, redaction, and false-success contracts pass. A configured-provider chat journey and authenticated browser proof are still absent. |
| Broad multi-file analysis | Hierarchical execution gives subtasks bounded loops, disjoint write scopes, preserved partial results, and a no-tools synthesis pass ([hierarchical executor](../lib/ai-orchestrator/src/agents/hierarchical-executor.ts#L4-L22)). | **Specialized stronger** | Broad analysis is deliberately bounded and evidence-checked. Recursive nesting and per-subquery SSE are explicitly out of scope ([same source](../lib/ai-orchestrator/src/agents/hierarchical-executor.ts#L19-L22)); long or highly interactive investigations may feel less fluid than a general Agent. |
| Structured scan/review | Analyze and review each have JSON and stream endpoints, context construction, fallback, parse/error handling, audit/event persistence ([analysis routes](../artifacts/api-server/src/routes/ai/analysis.ts#L174-L583)). | **Partial** | Provider prerequisite blocks live execution; no authenticated E2E result proves the full stream-to-history experience. |
| Conversational planning | Implementation planning requires a verified manifest and source excerpts and returns an explicit pending-approval/not-authorized outcome when grounding is missing ([chat planning guards](../artifacts/api-server/src/routes/ai/chat.ts#L605-L738); [baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Specialized stronger** | The safe plan boundary is stronger than implicit “agent edits.” The missing proof is provider-backed generation and browser confirmation, not the authorization model. |
| Bounded code changes | `write_file` queues pending changes; approval and proposal endpoints are distinct, and the API rechecks project context before authorizing writes ([chat agent](../lib/ai-orchestrator/src/agents/chat-agent.ts#L38-L42); [chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L4960-L5884)). | **Specialized stronger, operationally partial** | Users get a safe proposal rather than an immediate mutation. The complete plan → approval → validation → apply browser path was not run. |
| Candidate validation | Server-owned validation profiles, isolated workspaces, scope checks, redacted public receipts, and repair runners exist ([repair validation](../artifacts/api-server/src/lib/ai-repair-validation.ts#L113-L441)). | **Specialized stronger, provider-free verified** | Bounded validation and repair-loop release checks pass. A live delivery workspace campaign remains unproven. |
| Apply/promotion | Delivery workspace captures revisions and hashes; apply checks containment, duplicates, base/hash conflicts, proposal state, receipt, and journal before atomic promotion ([delivery workspace](../artifacts/api-server/src/lib/delivery-workspace.ts#L28-L88); [baseline §5](actual-capability-baseline-v1.md#5-change-delivery-trace)). | **Specialized stronger, operationally partial** | Provider-free operational-safety checks pass; no authenticated promotion journey demonstrates the complete path. |
| Conflict recovery | Rebase and apply paths hash the base, rebase hunks, preserve conflict metadata, and expose recovery/discard/resume-validation routes ([chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L5274-L5470)). | **Specialized stronger, E2E partial** | A changed workspace can block promotion safely and offer a retry path. No complete user journey has demonstrated successful rebase and retry. |
| Long-running task execution | Task execution uses ownership, status/rate limits, task logs/events, durable lifecycle helpers, and explicit concurrent-state responses ([task route](../artifacts/api-server/src/routes/ai/tasks.ts#L40-L140); [task agent](../lib/ai-orchestrator/src/agents/task-agent.ts#L27-L65)). | **Partial** | Provider-free ownership/concurrency/recovery checks pass, but real provider execution and a terminal browser journey are unproven. |
| Workflow execution | AI orchestration has a route; the broader workflow API supports start/stop/advance/fail/retry/rollback ([workflow route](../artifacts/api-server/src/routes/ai/workflows.ts#L47-L117)). | **Partial** | Workflow mechanics are present, but provider-backed orchestration and terminal E2E states remain unproven. |
| Cancellation, resume, and restart recovery | Durable execution rows, leases, checkpoints, hashed resume tokens, cancellation terminalization, ownership fences, and recovery endpoints exist ([execution state](../artifacts/api-server/src/lib/ai-execution-state.ts#L8-L205); [chat routes](../artifacts/api-server/src/routes/ai/chat.ts#L4632-L4700)). | **Specialized stronger, browser partial** | Provider-free SSE and operational-safety checks pass. Reload-after-restart and live transport evidence remain open; incomplete results must continue to be shown as incomplete. |
| Validation/evidence UX | Flight Deck renders operation, checkpoint, evidence, and validation state; Mission Control renders recovery actions and completeness; chat exposes validation attempts and proof details ([Flight Deck](../artifacts/dashboard/src/pages/FlightDeck.tsx#L1-L180); [Mission Control](../artifacts/dashboard/src/pages/MissionControl.tsx#L1-L225); [AiChat](../artifacts/dashboard/src/pages/AiChat.tsx#L2743-L2795)). | **Specialized stronger, browser partial** | The UI can explain blocked, incomplete, and unverified states rather than flattening them to success. No authenticated browser journey validated SSE rendering and refresh behavior. |
| Git delivery | Status/log/commit/push/export endpoints are separate and protected by project access/write middleware; release artifacts bind candidate evidence to a server-observed source revision ([Git routes](../artifacts/api-server/src/routes/git.ts#L180-L786)). | **Partial** | The live Git delivery path is implemented and route-tested, but the recorded controlled commit/push prerequisite is blocked. This is an operational proof gap, not a missing Git capability. |
| Audit/export | Operation evidence projects allowlisted events, receipts, revisions, proposals, commit, and push data; audit export is exposed by API ([operation evidence](../artifacts/api-server/src/lib/operation-evidence.ts#L118-L282); [chat audit route](../artifacts/api-server/src/routes/ai/chat.ts#L4481-L4500)). | **Parity for scoped product goal** | It is intentionally an audit artifact, not an IDE transcript or arbitrary workspace export. No download smoke check was run. |
| Provider resilience | OpenRouter has capability-aware fallback, dynamic free-model filtering, circuit breaking, error classification, and reliability tests ([model resolver](../lib/ai-orchestrator/src/openrouter/model-resolver.ts#L112-L187); [dynamic catalog](../lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts#L77-L197); [reliability tests](../lib/ai-orchestrator/src/__tests__/openrouter-reliability.test.ts#L1-L14)). | **Specialized stronger, provider-free verified** | Safe classification and recovery guidance are covered without credentials. Catalog freshness and live availability remain unproven; this is not a live-provider parity claim. |
| Arbitrary shell execution | Tool policy accepts server-owned command profiles; the model cannot provide shell text or arbitrary argv ([baseline row](actual-capability-baseline-v1.md#user-visible-capability-map)). | **Not a gap; intentional safer difference** | Some Replit-like workflows may be faster with broad shell access, but adding it would violate the product safety boundary and is a non-goal. |

## 3. Gap classification and priority

The highest-impact problems are reliability and proof gaps in an otherwise
implemented path. They must not be described as “the Agent cannot do X” when
the source provides X but the acceptance evidence is incomplete.

| Rank | Finding | Classification | User impact | Reliability / safety risk | Dependency |
|---|---|---|---|---|---|
| P0 | Provider-free contract and model resolution must remain deterministic; the required runtime-oracle scenario previously reported `broken` instead of `fixed`. | **Closed by provider-free evidence; keep as a regression gate** | The latest benchmark scenario and AI release checks pass; rollout policy is unchanged | High if a future false green authorizes bad behavior | Preserve existing OpenRouter stabilization and benchmark governance |
| P0 | Isolated validation previously had two 120-second timeouts. | **Closed for the bounded provider-free gate; live delivery still open** | Latest operational-safety and repair-validation checks pass; promotion is not yet E2E-proven | High if a stuck process is treated as a result | Controlled promotion E2E |
| P0 | The earlier selected API suite exposed active-task ordering, streamed cancellation, Git discovery fixture, and validation failures. | **Partially closed, not a green full-suite claim** | Targeted AI contract/SSE/operational-safety checks now pass; discovery and live Git proof remain open | High for terminal-state integrity and onboarding | Run the controlled campaign and retain historical failures |
| P1 | No authenticated provider-configured browser/API journey has completed the critical path. | Test/observability gap | Operators cannot trust the console’s end-to-end UX | High: code-backed safety may not survive integration | Requires controlled provider, Clerk browser state, and isolated project |
| P1 | Provider/catalog diagnostics need a clear operator-facing failure state and acceptance contract. | **Closed for provider-free classification; live availability remains a risk** | Missing key, authentication, catalog, and recovery actions are represented safely; live provider behavior is not proven | Medium; prevents unsafe retries and misclassification | Preserve existing catalog implementation; validate with controlled provider |
| P1 | Recovery transport and refresh behavior need a green cancellation/reconnect/restart journey. | Existing-but-unreliable behavior | Interrupted work may look lost or remain incomplete after reconnect | High for user trust and idempotency | After API cancellation/order fixes |
| P1 | Discovery durable Git fixture must match its documented async contract. | Test/fixture defect | New users can fail before importing a project | Medium | Before discovery smoke gate |
| P2 | Browser UX should make the critical path and blocked reasons more explicit. | Incomplete UX | Users may not know whether to approve, rerun validation, rebase, or start over | Medium, mostly usability | After P0/P1 correctness |
| P3 | Broaden general-Agent conveniences: richer recursive investigation, per-subtask streaming, more automatic environment setup. | Optional parity expansion | Improves speed and breadth, not correctness of the specialized product | Low relative to release blockers; may weaken boundedness | Only after production-ready specialized gates |

## 4. Closed work and remaining roadmap

The following items are closed at their available evidence level, not promoted
to production readiness:

| Closed item | Evidence boundary |
|---|---|
| Runtime-oracle/benchmark blocker | `validate:benchmark-scenarios`, deterministic benchmark, and release regression checks pass. The comparator may return `rolloutAllowed: true` for a clean regression comparison, while the approved baseline still has `qualityEligible: false` and `rolloutAllowed: false`; this does not authorize live-quality rollout. |
| Source-bound release identity | Release evidence carries server-observed source revision with the candidate hash; governance and comparison rules were not changed. |
| Provider recovery diagnostics | Provider-free API/SSE/dashboard checks cover classified failure states and safe next actions; no live provider quality claim follows. |
| Validation timeout hardening | Bounded validation and AI operational-safety checks pass; no live promotion or Git push receipt exists. |

The remaining roadmap is intentionally narrower than the earlier version:

Each item has a bounded outcome. These are recommendations only; this task does
not implement them.

### Immediate fixes (P0)

#### R1 — Keep the provider-free release gate truthful *(closed; regression owner)*

- **Affected surfaces:** `package.json` release scripts; orchestrator benchmark
  fixtures and OpenRouter contract tests; existing Task 12 benchmark work.
- **Acceptance:** the required runtime-oracle scenario passes with the expected
  verdict; the latest AI release decision has 9 passed checks and 0 blocking
  failures; rollout remains blocked when baseline quality or lineage evidence
  is incomplete.
- **Non-goals:** no new benchmark scenario set, no live provider requirement,
  and no redefining Task 12’s scope.
- **Dependency/risk:** first gate; high release risk if skipped.

#### R2 — Bound and diagnose isolated validation *(closed for provider-free gate)*

- **Affected surfaces:** `ai-repair-validation.ts`, registered command
  profiles, release validation fixtures.
- **Acceptance:** each validation attempt has a finite process/overall deadline,
  retains a redacted receipt, and ends as passed, failed, blocked, or unavailable
  rather than timing out the test harness; the two currently timing-out
  scenarios pass or produce an explicit audited block.
- **Non-goals:** no model-supplied commands, no weakening candidate/revision
  binding, and no bypass of validation for apply.
- **Dependency/risk:** required before promotion/apply E2E; high safety risk.

#### R3 — Repair terminal ordering and stream cancellation *(closed for targeted gate)*

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

| Maturity claim | Minimum pass evidence | Current position | Explicit limitations |
|---|---|---|---|
| Prototype | Typecheck; dashboard component/client contracts; deterministic truth-flow and benchmark structure; mocked route/component behavior. | **Supported** | Provider, browser, delivery, and recovery are not proven. Do not call this production-ready. |
| Usable internal tool | Prototype gates plus green provider-free API subset, green R1–R3 contracts, and one controlled authenticated journey covering chat or analysis and a persisted terminal result. | **Not established** | Targeted release contracts pass, but the required controlled authenticated journey is still missing; Git push, discovery breadth, and all delivery transitions remain unproven. |
| Production-ready specialized Agent | All provider-free release gates green; no validation timeout or terminal-ordering defect; controlled campaign passes discovery, grounded chat, analysis/review, task/workflow, plan approval, candidate-bound validation, apply, conflict retry, cancellation/restart, evidence reload/export, and safe Git commit/push. Provider diagnostics are actionable, and benchmark rollout is allowed. | **Not established** | The release decision passes its enabled provider-free checks, but preview/live checks are skipped and the benchmark baseline is not rollout-eligible. EngineeringOS remains intentionally narrower than a general IDE Agent. |
| Replit-like general workflow | Specialized gate plus repeatable broad project understanding and change delivery across supported project types/providers, bounded interactive progress, and documented environment setup/repair coverage. | **Not a current target** | Optional expansion only; it does not imply proprietary feature parity. |

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
2. prove the full path in a controlled authenticated campaign, including
   discovery, provider-backed work, approval/promotion, and Git commit/push;
3. retain explicit browser/restart evidence for recovery and export; and
4. validate provider/catalog diagnostics against a real configured provider.

The current decision is therefore: **provider-free specialized workflow
contracts are acceptable for internal use, but production-ready specialized
Agent status is not established**. The deterministic benchmark gate is fixed,
not opened: its structural baseline remains ineligible for live-quality
rollout. The source-bound Git delivery path is implemented, but its operational
commit/push proof is still missing. Only after the controlled gates pass should
breadth and speed enhancements be considered. No unrelated hosting,
collaboration, billing, IDE, or deployment feature is required for the current
specialized-Agent claim.
