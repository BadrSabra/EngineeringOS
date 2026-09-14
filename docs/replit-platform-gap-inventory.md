# EngineeringOS — Replit-like Platform Gap Inventory

**Observed date:** 2026-09-14  
**Scope:** current repository source, current tests/contracts, and the latest
recorded controlled-operation evidence available in this workspace  
**Purpose:** inventory observable platform outcomes and distinguish implemented
specialized-agent capabilities from unproven integrations and optional
general-platform expansion

This is an evidence inventory, not a parity claim and not a product
implementation plan. It does not modify product code, database schema, safety
boundaries, or dashboard behavior.

## 1. How to read this inventory

### Classification

| Classification | Meaning |
|---|---|
| **Implemented and proven** | Current source has the capability and a relevant deterministic, route, component, contract, or controlled-operation check proves the stated boundary. |
| **Implemented but evidence incomplete** | The source and focused tests provide the path, but an important browser, provider, restart, external-service, or full-journey check is missing. |
| **Partial / unreliable** | Only a bounded subset is implemented, or the source exposes a material correctness/reliability limitation that prevents a dependable broad outcome. |
| **Not implemented** | The current product surface does not provide the outcome. |
| **Intentional security difference** | The outcome is deliberately narrower than a general Replit-like Agent because the product keeps a server-owned authorization or safety boundary. It is not a defect to remove. |

“Implemented” does not mean “production-ready.” A provider-free fixture,
component test, or isolated local Git remote cannot prove a live provider,
authenticated browser campaign, production deployment, or external GitHub
delivery.

### Evidence hierarchy

1. Current source and current tests/contracts.
2. `docs/architecture.md`, which is the current architecture truth baseline.
3. `docs/actual-capability-baseline-v1.md` and
   `docs/runtime-coverage-matrix.md` for recorded evidence boundaries.
4. `docs/replit-agent-parity-gaps.md` for comparison framing and prior
   recommendations, never as a substitute for current source evidence.

Historical phase reports and closed-task narratives do not override the
current source. This report also does not infer a capability from a route name:
the user-visible transition and its acceptance evidence must exist.

## 2. Executive result

EngineeringOS is a real, specialized engineering-operations console. The
source supports:

- owner-scoped project discovery, scanning, graph/metrics views, and a
  dashboard;
- source-first AI questions with bounded read/list/search tools;
- forensic/evidence acceptance that fails closed when required source proof is
  absent, stale, truncated, or unattributed;
- implementation planning that remains `PENDING_APPROVAL` and
  `NOT_AUTHORIZED` until server-owned gates authorize the next transition;
- isolated candidate validation, apply/promotion, conflict handling, audit
  records, and scoped Git delivery;
- durable execution state, leases, checkpoints, cancellation, reconciliation,
  recovery, and operator-facing evidence projections.

The specialized workflow is therefore substantially implemented and is safer
than an unrestricted code Agent in several areas. It is **not established as a
production-ready Replit replacement or as a fully proven autonomous Agent**.
The highest-impact remaining risks are proof and operational integration gaps,
not a missing foundation.

The most important current boundaries are:

1. A configured live provider and a complete authenticated browser journey
   remain unproven as one uninterrupted discovery-to-push flow.
2. Discovery/import is well covered with local and fixture-backed paths, but
   the recorded real remote discovery fixture was rejected by the intentional
   credential-free GitHub URL policy; this is not evidence of broad remote
   source parity.
3. Restart/reconnect/recovery logic is durable and deterministically tested,
   but cross-process browser reload/restart evidence is incomplete.
4. Validation, Apply, promotion, commit, and push have server-owned gates and
   isolated route proof, but no complete authenticated live promotion receipt
   has been established.
5. Repository freshness and index completeness over long-running jobs are not
   guaranteed by the current evidence.
6. The AI project budget reports a token limit, but current admission source
   checks the daily attempt limit rather than projected token usage; this is a
   concrete readiness gap requiring focused correction and tests.
7. The general Replit-like surface is intentionally absent in areas such as a
   hosted IDE, arbitrary model shell, teams/RBAC, deployment/preview
   provisioning, and broad collaboration.

## 3. Observable user-outcome inventory

The comparison unit is what a user can observe:
understand a project, ask grounded questions, plan, make bounded changes,
validate, recover, deliver, and use broader platform capabilities.

| Outcome | Current implementation and evidence | Classification | User-visible boundary |
|---|---|---|---|
| **Project understanding** | Project list/search and discovery wizard in `artifacts/dashboard/src/pages/Projects.tsx` and `DiscoverProjectWizard.tsx`; discovery source resolution, durable materialization, ownership, polling, summary, import, and cleanup in `artifacts/api-server/src/routes/discovery.ts`; scan, graph, metrics, and project detail in `ProjectDetail.tsx` and `Graph.tsx`. Route/component coverage exists in `artifacts/api-server/src/routes/discovery.test.ts`, `artifacts/dashboard/src/pages/Projects.test.tsx`, and `Graph.test.tsx`. | **Implemented but evidence incomplete** | Local/fixture-backed discovery and project views are present. A full real-source, authenticated browser discovery → scan → import journey is not established. The wizard intentionally disables ZIP, remote FS, and Docker sources. |
| **Grounded questions** | `POST /api/ai/chat` and `/stream`; `chat-agent.ts`, `tool-execution-engine.ts`, `query-planner.ts`, filesystem manifest/evidence integrity, persisted sessions, source spans, provenance and redaction in `AiChat.tsx`. Tests include `tool-execution-engine.test.ts`, `query-planner.test.ts`, `evidence-integrity.test.ts`, `chat-evidence-integrity-e2e.test.ts`, `AiChat.authenticated.test.tsx`, and dashboard journey contracts. | **Implemented and proven for provider-free contracts; live/browser incomplete** | The system can reject unsupported scope, retain source lineage, and distinguish incomplete evidence. A live configured-provider answer is not proven by deterministic fixtures. |
| **Broad project analysis** | Bounded hierarchical execution in `lib/ai-orchestrator/src/agents/hierarchical-executor.ts`, structured analyze/review routes, no-tools synthesis, preserved partial results, and coverage checks. | **Implemented but evidence incomplete** | Bounded waves are deliberate. Recursive nesting, per-subquery SSE, and broad large-repository completeness are not current guarantees. |
| **Conversational planning** | `implementation-planner.ts` requires a verified manifest/source excerpts and uses `PENDING_APPROVAL`/`NOT_AUTHORIZED` fallback; chat routes and dashboard render proposals and rehydration. Evidence: `implementation-planner-grounding.test.ts`, `AiChat.authenticated.test.tsx`, and acceptance tests. | **Implemented and proven as a safety boundary; provider/browser evidence incomplete** | Planning is not write authorization. The missing proof is a live generation and browser transition, not permission to bypass approval. |
| **Bounded changes** | `write_file` queues proposed changes; `AiChat.tsx` requires proposal, validation profile, revision-aware reapproval, and explicit Apply/Rebase/Reject. Candidate/live tree integrity is enforced in `delivery-workspace.ts`, `ai-change-guard.ts`, and `routes/ai/chat.ts`. | **Implemented but evidence incomplete** | The product does not offer automatic mutation. The complete plan → approve → validate → apply transition has deterministic coverage but lacks a complete authenticated live journey. |
| **Validation and repair** | Server-owned profiles and isolated workspaces in `artifacts/api-server/src/lib/ai-repair-validation.ts`; bounded process/overall deadlines, runtime oracles, receipts, Repair Radar and Flight Recorder in `AiChat.tsx` and `FlightDeck.tsx`. Tests include `ai-repair-validation.test.ts`, `routes/ai-repair-loop-e2e.test.ts`, `FlightDeck.test.tsx`, and validation SSE contracts. | **Implemented and proven for provider-free validation; live promotion incomplete** | Model narrative cannot satisfy a server-owned check. A live delivery workspace campaign has not produced a complete authenticated validation/promotion receipt. |
| **Conflict and interruption recovery** | Durable execution rows, leases, resume tokens, checkpoints, cancellation fences and startup reconciliation in `ai-execution-state.ts`, `job-reconciliation.test.ts`, and `artifacts/api-server/src/index.ts`; Mission Control and Flight Deck expose blocked/incomplete/recovery state. | **Implemented but evidence incomplete** | Recovery is designed not to turn interruption into success. Browser reload after process restart and all transport races remain outside the proven boundary. |
| **Safe delivery** | Flight Deck sequences Mission → Plan → Explore → Build → Validate → Repair → Review → Apply → Commit → Push; commit/push controls are gated by terminal state. Git routes enforce operation, candidate/tree, change-set, identity, and post-commit proof. Tests: `FlightDeck.test.tsx`, `routes/git.test.ts`. | **Implemented but evidence incomplete** | Isolated local/bare-remote Apply → commit → push is proven. Clerk-authenticated delivery to a disposable external remote and the full discovery-to-push journey are not proven. |
| **Audit and operator explanation** | Audit/event persistence, allowlisted/redacted operation evidence, history/detail/export routes, Mission Control filters and exports, and correlation projections. Evidence includes `audit.integration.test.ts`, `operation-evidence.test.ts`, `MissionControl.test.tsx`, and AI route tests. | **Implemented and proven for contracts; download/live journey incomplete** | Operators can see evidence, gaps, receipts, and next actions in tested component/API paths. A fresh authenticated download smoke and production monitoring campaign are not claimed. |
| **Project collaboration** | Single owner ID and project access/write middleware; no member, role, or team surface. `docs/architecture.md` §3 documents the boundary; `docs/gap-analysis-closure.md` identifies multi-role RBAC as future scope. | **Not implemented** | This is a single-owner engineering console, not a multi-user collaborative workspace. |
| **Hosted IDE and live preview** | No editor, preview, deployment, or environment-provisioning routes in `artifacts/dashboard/src/App.tsx` or `Sidebar.tsx`; current product centers on source analysis and controlled delivery. | **Not implemented** | Users do not receive a Replit-style browser IDE or one-click hosted runtime from the current product. |
| **Arbitrary shell execution** | `lib/ai-orchestrator/src/tools/execution-tools.ts` and `tool-execution-engine.ts` accept server-owned command profiles, not model-supplied executable/argv. | **Intentional security difference** | A broader shell would enable more general workflows but would violate the product’s current execution boundary. |

## 4. Platform-layer inventory

### 4.1 API and contracts

**Status: implemented and proven for provider-free contracts; operationally
incomplete at live boundaries.**

- Express routes cover projects, tasks, rules, workflows, events, metrics,
  graph, discovery, scanning, AI, Git, uploads, and runtime operations in
  `artifacts/api-server/src/routes/` and registration in
  `artifacts/api-server/src/routes/index.ts`.
- `lib/api-spec/openapi.yaml` is the contract authority. Generated React
  Query and Zod clients are checked by
  `scripts/validate-dashboard-client-contract.mjs`,
  `scripts/parse-check-spec.ts`, and
  `scripts/root-build-contract.test.mjs`.
- Auth and project access are enforced by Clerk middleware and
  `requireProjectAccess`/`requireProjectWriteAccess`; focused tests cover
  unauthenticated, owner, foreign-project, archived-project, and mutation
  cases.
- The API exposes JSON and SSE variants for chat and structured analysis,
  with terminal, incomplete, cancellation, recovery, and redaction
  contracts.

**Evidence boundary:** API tests run with mocked or fixture providers and
test-mode auth. They prove contract and safety behavior, not provider quality,
production deployment, or a full authenticated browser journey.

### 4.2 Dashboard

**Status: implemented and tested as a specialized console; full live journey
incomplete.**

`artifacts/dashboard/src/App.tsx` and `Sidebar.tsx` expose authenticated
routes for projects, tasks, rules, workflows, events, metrics, graph, AI,
Flight Deck, and Mission Control. The dashboard has tested surfaces for:

- discovery and project detail;
- source-backed chat and evidence panels;
- proposal, validation, Apply/Rebase/Reject, commit and push states;
- Flight Deck operation phases and proof;
- Mission Control history, correlation, recovery, redacted exports, and
  next-safe-action states.

The dashboard does not expose editor, hosted preview, deployment, teams,
billing, collaboration, or environment-provisioning routes.

**Evidence boundary:** `AiChat.authenticated.test.tsx`,
`FlightDeck.test.tsx`, `MissionControl.test.tsx`, dashboard contract tests,
and the recorded authenticated shell checks are not equivalent to a green
live-provider discovery-to-push browser campaign. Release journey fixtures
intercept AI by default; live provider and campaign modes are explicit opt-in.

### 4.3 Database and durable state

**Status: implemented and proven at schema/transaction/state-contract level;
production convergence incomplete.**

The schema in `lib/db/src/schema/` includes projects, discovery sessions,
scan jobs, graph entities/relationships, metrics, events, audit logs,
conversations, provider credentials, AI executions, AI budgets, task logs,
and related durable state. Application and audit schema contracts are covered
by `lib/db/src/application-schema-check.test.ts` and
`lib/db/src/audit-schema-check.test.ts`.

The durable boundary is sound for the current specialized product:

- Postgres rows are the source of truth for queued/recoverable work.
- The process-local queue is a dispatch handle, not the durable job record.
- Leases, heartbeats, worker identities, idempotency keys, checkpoints and
  terminal fences prevent stale workers from overwriting newer state.
- Startup reconciliation and periodic dispatch recover persisted queued work.

**Limitations:** no current evidence in this inventory proves production
migration/restart convergence, distributed worker scale, or an in-flight scan
checkpoint that resumes from the middle. Scans are requeued within budget;
interrupted discovery is marked error because its intermediate filesystem state
cannot safely be reconstructed. AI executions have a separate checkpoint/resume
contract.

### 4.4 AI and orchestrator

**Status: specialized-agent core implemented and strongly contract-tested;
provider/live operational evidence incomplete.**

The AI layer includes provider registry and capability filtering, bounded
fallback, intent routing, context admission, tool authorization, source-first
planning, evidence integrity, structured profiles, task/workflow agents,
forensic recovery, durable execution, and acceptance projections. Relevant
source includes:

- `lib/ai-orchestrator/src/turn-intent.ts`
- `lib/ai-orchestrator/src/agents/chat-agent.ts`
- `lib/ai-orchestrator/src/agents/query-planner.ts`
- `lib/ai-orchestrator/src/agents/implementation-planner.ts`
- `lib/ai-orchestrator/src/tool-execution-engine.ts`
- `lib/ai-orchestrator/src/evidence-integrity.ts`
- `lib/ai-orchestrator/src/quality-engine.ts`
- `artifacts/api-server/src/lib/ai-execution-acceptance.ts`
- `artifacts/api-server/src/lib/operational-readiness-gate.ts`

The acceptance boundary is fail-closed: missing, truncated, oversized,
unattributed, stale, or cancelled evidence cannot become a verified result.
AI-generated remediation text remains narrative and cannot satisfy
server-owned validation or acceptance.

**Readiness limitation:** context is bounded to a manifest and selected source
windows. `lib/ai-orchestrator/src/filesystem-manifest.ts` limits the number of
files, directories, depth, selected source files, total characters, and
individual excerpts. Large monorepos can therefore yield partial evidence;
the UI must retain that incompleteness rather than imply comprehensive
understanding.

### 4.5 Scanner

**Status: implemented and proven for bounded extraction; freshness and broad
completeness remain partial.**

`lib/scanner/src/` provides file walking, rule matching, metrics, graph
extraction, provenance, TypeScript compiler AST handling, Python AST handling,
and isolated regex fallback. Tests cover file walking, graph extraction,
syntax-error fallback, rules, and metrics.

AST evidence has stronger confidence and source location metadata. Regex or
fallback relationships can be file-traceable without a line/column/snippet and
must remain navigation/context evidence, not standalone behavioral proof.
`SCANNER_VERSION` and graph provenance exist, but the inspected tests do not
establish comprehensive stale graph deletion/revision cleanup or a long-running
freshness SLA.

### 4.6 Knowledge engine

**Status: implemented and tested for bounded graph queries; authority and
tenant-isolation coverage need hardening.**

`lib/knowledge-engine/src/queries.ts` provides bounded BFS, paths,
neighborhoods, filters and related queries; `inference.ts` provides degree
centrality and connected-component heuristics. Query and inference tests
cover the intended algorithms.

The engine is deliberately simple and graph-empty projects return empty
results. Some neighborhood incoming-edge query paths need a focused explicit
project-scope regression check before graph traversal is treated as authoritative
proof. Graph results must remain subordinate to source-owned evidence and
project/revision binding.

### 4.7 Git and external delivery

**Status: implemented and proven against isolated fixtures; external delivery
evidence incomplete.**

`artifacts/api-server/src/routes/git.ts` exposes status, log, commit, push, and
export. AI-scoped commit/push requires matching operation identity, canonical
tree, change set, Git identity, and post-commit proof. `git.test.ts` covers:

- rejecting Apply without the required evidence;
- unrelated-change rejection;
- local commit receipt recovery;
- Apply → commit → push against a bare remote;
- uncertain remote push recovery and retry behavior.

**Evidence boundary:** no current source/test evidence proves Clerk-authenticated
push to a real external GitHub remote from the complete dashboard journey.
The discovery policy intentionally rejects arbitrary/local Git URLs and allows
only the credential-free supported GitHub form, so localhost smart-HTTP fixtures
must use an explicit test seam rather than being represented as real remote
support.

### 4.8 Recovery and runtime operations

**Status: durable behavior implemented and deterministically tested; live
cross-process/browser evidence incomplete.**

The runtime includes persisted execution identity, lease ownership, heartbeats,
checkpoint versions, cancellation registration, resume-token hashing,
startup reconciliation, stale-job sweeps, terminal-state projection, and
operator recovery views. Current source and tests include
`ai-execution-state.ts`, `job-reconciliation.test.ts`,
`operational-readiness-gate.test.ts`, process-recovery receipt checks, and
dashboard authenticated/recovery tests.

The boundary is conservative:

- EOF after a terminal frame is clean completion.
- A disconnected or cancelled operation cannot be upgraded to success.
- Recovery is authoritative only when durable state and acceptance agree.
- Incomplete or uncertain work is retained and rendered as incomplete.

No production cross-process campaign, exhaustive browser-tab race campaign,
or long-running freshness campaign is claimed here.

### 4.9 Validation, promotion, and audit

**Status: server-owned validation and audit contracts are implemented and
proven; end-to-end live promotion remains incomplete.**

Candidate validation uses isolated workspaces and fixed command profiles.
Apply/promotion checks project ownership, approved proposal state, path
containment, duplicate paths, base hashes, candidate stability, revision/tree
identity, validation receipts, and promoted-tree equality. Audit/event
records carry operation and correlation identity, while public projections
redact provider diagnostics and untrusted content.

`FlightDeck.tsx` and `MissionControl.tsx` expose the resulting proof,
receipts, gaps, blocked reasons, and recovery actions.

**Evidence boundary:** provider-free validation and isolated Apply/Git route
tests do not prove an authenticated browser approval → validation → promotion
journey or a downloaded audit artifact in a live deployment.

### 4.10 Budgets, telemetry, and monitoring

**Status: partial / unreliable as a complete control plane.**

Project budget schema, attempt reservation, idempotency, usage summaries,
operator alerts, metrics routes, telemetry persistence, fallback/latency/token
categories, redaction, and owner scoping are implemented. Relevant source and
tests include:

- `artifacts/api-server/src/lib/ai-budget.ts`
- `artifacts/api-server/src/lib/ai-telemetry.ts`
- `artifacts/api-server/src/routes/ai/operator-alerts.ts`
- `artifacts/api-server/src/routes/metrics.ts`
- `artifacts/api-server/src/lib/ai-telemetry.test.ts`
- `artifacts/api-server/src/routes/ai/operator-alerts.test.ts`
- `artifacts/api-server/src/routes/metrics.test.ts`

Two material limitations remain:

1. `dailyTokenLimit` is reported, but the current admission branch checks
   projected daily attempts rather than projected token usage. Token
   exhaustion is therefore not a proven admission blocker.
2. Telemetry persistence is best effort and logs/continues when its database
   write fails. Monitoring is not itself a hard execution gate.

The project reservation budget and user-wide daily attempt limit are separate
concepts. Operators need them clearly distinguished to avoid treating a
successful telemetry write or an attempt limit as complete token accounting.

## 5. Broader Replit-like platform surface

These capabilities are outside the current specialized EngineeringOS contract.
Their absence is a product boundary, not evidence that the specialized
workflow is missing.

| Broader capability | Current state | Classification | Recommendation |
|---|---|---|---|
| Browser IDE/editor with file tree, terminal and inline editing | No dashboard route or source surface | **Not implemented** | Optional P3 expansion only after specialized operational acceptance. |
| Hosted previews, deployments, environment provisioning | No current route/surface or deployment proof in this product | **Not implemented** | Optional P3; keep separate from validation profiles and never infer hosting from local runtime checks. |
| Team workspaces, collaborators, roles and permissions | Single owner model; no members/roles tables or dashboard flow | **Not implemented** | Optional P3; requires a separate authorization/product design, not a middleware alias change. |
| Real-time multiplayer collaboration | No shared editing or presence model | **Not implemented** | Optional P3, low priority for the specialized mission. |
| Billing, plans, quotas and organization administration | AI project/user limits exist, but no general billing/team plan surface | **Partial / different scope** | Do not treat AI budget telemetry as a billing system. Optional expansion. |
| Broad language/framework/environment setup | Scanner and validation profiles are bounded and project-specific | **Partial / unreliable for broad parity** | Expand only with explicit support matrix and per-profile proof. |
| Binary/image/PDF semantic search | Binary evidence searchability is deferred; opaque assets are not source-query equivalents | **Not implemented** | Optional P3; do not weaken source-proof rules to make binaries appear grounded. |
| Arbitrary model shell commands | Model receives server-owned profiles only | **Intentional security difference** | Preserve. Any future expansion must keep server-owned commands, scopes, timeouts, and receipts. |
| Distributed always-on worker fleet | Durable DB records and local dispatch/reconciliation exist; no independent worker service | **Partial / unreliable for Replit-scale execution** | Optional platform expansion if workload/deployment requirements change. |

## 6. Specialized-agent readiness versus optional expansion

### Specialized readiness blockers

These affect whether EngineeringOS can honestly claim a dependable
source-backed engineering Agent:

1. **Controlled critical-path evidence:** discovery, provider-backed grounded
   chat, structured analysis/review, task/workflow terminal states, plan
   approval, isolated validation, Apply, conflict retry, cancellation/restart
   reload, audit export, and scoped Git delivery need a retained operation
   receipt in one controlled campaign.
2. **Budget admission correctness:** enforce projected token limits at the same
   server-owned admission boundary as attempt limits, then test reservation,
   exhaustion, reconciliation, fallback, and restart behavior.
3. **Repository and graph proof boundaries:** add focused regression coverage
   for graph project scoping, stale graph cleanup/revision changes, and
   oversized/truncated source handling so graph or fallback evidence cannot be
   promoted to behavioral proof.
4. **Freshness evidence:** define and verify what “fresh enough” means across
   rescans and long-running jobs; preserve revision mismatch as an explicit
   blocked/incomplete state.
5. **Provider/operator evidence:** validate missing-key, authentication,
   catalog, rate-limit, quota, outage, and fallback states with a controlled
   configured provider without exposing credentials or raw diagnostics.

These are evidence/reliability gaps in an implemented specialized workflow.
They are not reasons to add a hosted IDE or arbitrary shell execution first.

### Optional general-platform expansion

These are valuable only after the specialized gates are dependable:

- a browser IDE/editor and hosted previews;
- team collaboration and role-based access;
- deployment/environment provisioning;
- broader language/framework and environment setup;
- richer recursive investigation and per-subtask streaming;
- binary/image/PDF indexing;
- independent distributed workers and long-horizon runtime monitoring;
- billing and organization administration.

Each expansion needs its own ownership, authorization, evidence, and recovery
model. None should reuse provider output or a local fixture as a substitute
for server-owned proof.

## 7. Prioritized gap register

Priorities describe user impact and readiness risk, not implementation size.
The register avoids duplicating the already tracked scope-preservation,
accepted-evidence reuse, and benchmark work.

### P0 — correctness and trust

| Gap | Why it matters | Dependency | Observable acceptance criteria |
|---|---|---|---|
| **Token budget is reported but not enforced at admission** | A project can appear to have a daily token limit while still allowing provider attempts after projected token exhaustion. | Existing `ai-budget.ts` reservation/usage model; no new budget subsystem. | A request that would exceed the projected token limit is rejected before provider work; reservations are idempotent; partial/unknown usage remains conservative; reconciliation after crash cannot reopen exhausted budget; API/operator projection states the reason without provider diagnostics. |
| **Graph and scanner freshness are not a complete proof guarantee** | Stale or weak graph/fallback data can mislead navigation or scope selection if later code treats it as source proof. | Existing graph provenance, scanner revision, source-read/evidence acceptance. | A changed/deleted file or graph revision mismatch is surfaced as stale/incomplete; every graph traversal used for project evidence is project-scoped; regex/fallback evidence cannot satisfy a behavioral objective without a complete source read; focused tests cover incoming-edge and cleanup paths. |

### P1 — operational proof

| Gap | Why it matters | Dependency | Observable acceptance criteria |
|---|---|---|---|
| **No complete controlled discovery-to-push acceptance receipt** | Operators cannot distinguish “the route exists” from “the product completed its main user journey.” | Provider/configured test account, Clerk browser state, disposable project and remote, existing release isolation. | One retained, redacted campaign receipt correlates discovery session, scan, chat/analysis, plan, approval, validation, Apply, conflict or retry, cancellation/restart recovery, audit export, commit and push; every terminal state matches durable server acceptance. |
| **Restart/reconnect evidence is not yet a full browser proof** | A user may lose confidence after an API restart even though durable recovery code exists. | Existing execution leases/checkpoints/reconciliation and dashboard recovery UI. | Kill/restart during a bounded stream and during a queued job; reload the dashboard; show exactly one authoritative terminal state, retained evidence, safe next action, and no false success or duplicate assistant result. |
| **Provider diagnostics need live confirmation** | Provider-free fixtures prove classification shape but not real catalog, quota, or outage behavior. | Existing provider registry, catalog, fallback, telemetry and redaction. | Controlled provider checks distinguish missing credential, auth failure, no compatible model, stale catalog, rate limit, quota and outage; each renders one safe action and correlation ID; secrets/raw diagnostics never reach persisted or streamed user output. |

### P2 — usability and supportability

| Gap | Why it matters | Dependency | Observable acceptance criteria |
|---|---|---|---|
| **Blocked and incomplete states are not yet a uniform critical-path guide** | The individual surfaces expose safe actions, but a user should not have to infer whether to refresh, rescan, reapprove, rebase, resume validation or review manually. | Stable terminal outcome and evidence projections; current `AiChat`, `FlightDeck`, `MissionControl`. | Every blocked, conflicted, cancelled, unavailable and retained-with-gaps state shows one operation/revision-aware next action; action cannot silently mutate or bypass evidence gates; component and browser checks cover each state. |
| **Large-project completeness needs more visible admission detail** | Manifest and excerpt caps are safe but can feel like unexplained partial understanding. | Existing manifest status, context admission and evidence panels. | The UI identifies omitted/truncated scope, explains its effect on the answer, offers a bounded rescan/narrowing action, and never labels a partial read comprehensive. |

### P3 — optional Replit-like expansion

| Gap | Why it matters | Dependency | Observable acceptance criteria |
|---|---|---|---|
| **General IDE/preview/deployment experience** | It would broaden the product from an engineering-operations console into a hosted development platform. | Specialized P0/P1 gates, deployment architecture, environment isolation, observability and billing decisions. | Separate artifact/route supports edit, preview, deploy, rollback and logs with owner-scoped environments, server-owned commands, durable status, and explicit production evidence. |
| **Collaboration, roles and organization controls** | It would support multiple engineers and shared projects. | New membership/role model, authorization review, audit semantics, invitations and organization lifecycle. | A member can only see and mutate resources allowed by role; every route, graph query, AI execution, export and Git action is role-scoped; browser and API authorization tests cover owner/member/admin boundaries. |
| **Broader investigation and artifact indexing** | Recursive analysis, per-subtask progress and binary/PDF/image search would improve breadth. | Evidence lineage, bounded budgets, media extraction/indexing and revised UI contracts. | Optional modes retain operation budgets, cancellation, per-subtask evidence, source/revision binding, and fail-closed behavior when extraction is unavailable. |

## 8. Explicit evidence boundaries

The following statements are intentionally conservative:

| Boundary | What is supported | What is not claimed |
|---|---|---|
| **Live provider use** | Provider registry, capability filtering, fallback, classification and redaction are source-backed and provider-free tested. | No live provider quality, model availability, quota behavior, or complete provider-backed browser answer is claimed. |
| **Authenticated browser journeys** | Clerk middleware, dashboard protection, component tests, contract tests, and recorded shell navigation exist. | No full green authenticated discovery-to-push browser journey is claimed. |
| **Discovery/import** | Local folders, supported Git source policy, durable sessions/materialization, ownership, polling, import, cleanup and fixture tests exist. | No broad remote repository/provider parity; the recorded localhost smart-HTTP fixture was rejected by the production URL policy. |
| **Reload/restart recovery** | Durable rows, leases, checkpoints, resume/cancel fences and reconciliation are tested. | No production or exhaustive cross-process browser reload/restart campaign is claimed. |
| **Validation/promotion** | Server-owned profiles, isolated workspaces, candidate/revision/tree gates, receipts and Apply route tests exist. | No live authenticated plan-to-promotion receipt is claimed. |
| **External Git commit/push** | Isolated local/bare-remote route proof exists, including uncertain push recovery. | No external GitHub push from the authenticated complete user journey is claimed. |
| **Repository freshness/index completeness** | Per-run file walking, scan revisions, manifests, cache invalidation and mismatch gates exist. | No long-running freshness SLA or continuously complete repository index is claimed. |
| **Audit/export** | Redacted operation evidence, history, CSV/JSON projections, and route/component tests exist. | No production download smoke or deployment observability claim is made. |
| **Budgets/monitoring** | Attempts, telemetry, operator alerts and scoped metrics are implemented. | Token-limit admission, billing completeness, telemetry durability as a hard gate, and long-horizon monitoring are not fully proven. |

## 9. Suggested verification order

This order maximizes evidence value without widening the product prematurely:

1. Correct and test token-budget admission.
2. Add graph project-scope and stale-revision/deletion regression checks.
3. Define the freshness receipt and large-project partial-evidence UX.
4. Run the isolated authenticated provider campaign with a disposable project
   and remote.
5. Run restart/reconnect checks during both a stream and queued durable work.
6. Use the retained receipts to decide whether P2 UX work is needed before
   considering any P3 platform expansion.

The current product should be described as a **specialized,
provider-free-contract-proven engineering console with incomplete live
operational evidence**, not as a general Replit replacement.
