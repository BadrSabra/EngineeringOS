# Forensic Gap Analysis: EngineeringOS vs. a Modern Autonomous Software-Engineering Agent

**Evidence standard.** This assessment is based on current source call chains and side effects. File names, schemas, routes, dashboard affordances, test names, and older reports are discovery aids, not proof by themselves. “Cannot Verify From Current Source” is used where the claim requires deployment, live-provider, or long-horizon runtime evidence that is not retained in the repository. Recommendations are not current capability claims.

## Executive Verdict

EngineeringOS has a strong safety-and-observability foundation, but it is not source-proven equivalent to an autonomous software-engineering agent. It can inspect a project, build bounded context, plan a scoped multi-file change, queue deferred edits, run server-approved checks, persist checkpoints, and expose guarded apply/commit/push actions. It does **not** currently show one uninterrupted, server-owned loop that can discover a defect, mutate an isolated working tree, verify the mutation in that same tree, repair failures, and deliver the result without crossing explicit human/API approval boundaries.

The most consequential verified break is in `artifacts/api-server/src/routes/ai/chat.ts`: apply creates an operation-scoped delivery workspace (`createDeliveryWorkspace`), but the behavioral validation call uses the resolved live project root (`runRepairValidation(resolvedRoot, ...)`). The isolated artifact is therefore not the behavioral test target. Apply also writes the live root sequentially and uses compensating rollback; a process crash between writes and rollback can leave an unknown filesystem state. These are integrity failures, not merely missing convenience.

The durable execution work materially improves the picture. `ai-executions` has ownership, idempotency, leases, checkpoints, bounded traces, cancellation state, and terminal receipts; task execution uses the same lifecycle service. File writes are approval-deferred, paths are guarded lexically and by realpath, command execution uses registered profiles and `shell:false`, browser checks are origin- and step-bounded, and Git delivery has scoped evidence gates. Scanner roots fail closed, graph data has provenance machinery, and audit writes use an outbox. These controls should be extended, not replaced.

The defensible verdict is:

* **Implemented in source:** bounded inspection, project access checks, deferred scoped changes, fixed-profile validation/tool execution, durable execution primitives, audit/event instrumentation, delivery guards, and several fail-closed evidence checks.
* **Partial:** repository intelligence, planning, repair, cancellation, restart recovery, memory/history, workflow orchestration, and Git delivery as an autonomous loop.
* **Unsafe:** validation target versus delivery workspace, crash atomicity of live-root apply, task cancellation during an in-flight provider call, non-Replit root policy, and several information/TOCTOU edges.
* **Missing:** a continuously resumable server-owned plan→apply-in-isolation→validate→repair→delivery loop with a single authoritative operation state.
* **Cannot Verify From Current Source:** production parity, live-provider reliability, real deployment behavior, and successful end-to-end delivery under external credentials.

Historical documents are not treated as current evidence. In particular, `docs/ai-orchestrator-gap-analysis.md` predates deferred writes, advisory locks, delivery journals, and current retention/evidence work; `docs/RUNTIME_EXECUTION_MATRIX.md` is an inventory, not an execution proof.

## Current Execution Architecture

### 1. Request intake, identity, and project boundary

The normal AI stream enters `artifacts/api-server/src/routes/ai/chat.ts` (body validation and intent resolution around 1989–2041). It validates project/session/task/build/execution/resume/idempotency/objective fields, loads the project through `loadProjectByIdForUser`, and checks the project root and conversation/plan relationship for build handoff. `requireAuth` is applied globally in `app.ts` and defensively on ordinary routers; `requireProjectAccess.ts` scopes reads and writes by owner and rejects archived projects.

A new durable execution is reserved by `createAiExecution`, then claimed by `claimAiExecution`. An existing execution restores the stored request and bounded checkpoint and requires a resume token before claiming. The request is immutable enough to bind project/session/task/revision and operation identity; the unique `(userId, idempotencyKey)` path re-reads an insert race instead of creating two identities. The final side effect is a stream, chat message, execution row, or proposal depending on intent.

### 2. Context and repository understanding

`buildProjectContext` is called from chat, analysis, workflow, and task routes. The current context sections include tasks, metrics, graph entities/relationships, events, and workflows where relevant. The scanner (`lib/scanner/src/file-walker.ts`) bounds depth, file count, per-file bytes, and ignored directories; `graph-extractor.ts` produces entities, relationships, extraction evidence, and provenance. `scan-runner.ts` re-establishes the persisted root through `establishProjectRoot`, walks it, computes rules/metrics, extracts the graph outside the DB transaction, and atomically persists tasks, graph, metrics, project status, audit, and event effects.

`context-loader.ts` project-scopes bounded reads and uses a repeatable-read transaction for its multi-query snapshot. Cache invalidation is called after relevant writes. This is useful repository intelligence, but it is primarily static scan/graph/context assembly; no source proves complete semantic indexing, reliable incremental invalidation for every mutation, or production-scale behavior. Legacy graph rows and old diagnostics may retain less provenance than current scans.

### 3. Provider routing and orchestration

`requireProvider`/`runAgentWithFallback`/`chatWithFallback` resolve a configured provider, classify failures, and provide bounded fallback behavior. `lib/ai-orchestrator/src/agents/chat-agent.ts` constructs the agent prompt and invokes `executeToolLoop`; execution-plan requests use `executeExecutionNodePlan`. `execution-node-coordinator.ts` schedules dependency-aware waves, disjoint file scopes, bounded attempts, and legal node transitions. A node is not accepted as passed merely because a model says so: the caller must report observed validation.

The orchestration boundary still depends on model-produced plans and bounded callbacks. The server owns allowed files, profiles, and state transitions, but the source does not establish that every provider call has an equivalent durable per-tool receipt or that all semantic claims are independently rechecked. Provider output is treated as untrusted at public boundaries, while raw diagnostics remain logs.

### 4. Tools and mutation

`lib/ai-orchestrator/src/tools/file-tools.ts` executes read/list/search immediately. `write_file` and `replace_text` append `PendingChange` records and never write disk. `safePath` applies lexical and realpath containment and rejects null bytes. `tool-policy.ts` and `tool-execution-engine.ts` re-check workspace mode, approved manifest, operation scope, and tool arguments.

`execution-tools.ts` permits only server-registered command/browser profiles. `execution-kernel.ts` resolves contained cwd, uses `spawn` with `shell:false`, bounds output and time, and terminates process groups. Git tools exposed to the model are read-only status/diff/log. This is a deliberate safety boundary: model intent alone cannot become an arbitrary shell command or live file write.

### 5. Plan approval, apply, and validation

Build handoff in `chat.ts` requires an approved implementation-plan message, `APPROVED` plus `APPROVED_FOR_BUILD`, a nonempty safe file scope, and a server-owned execution plan. Proposal creation validates change schemas, plan phases, evidence/reachability requirements where applicable, and registered validation profiles.

`POST /ai/chat/apply-changes` requires project access, a pending proposal, exact authorized file/hunk/content subset, operation identity, and an advisory apply lock. It creates a `deliveryWorkspace`, performs duplicate/path/symlink/sensitive-extension/base-hash/content-drift checks, and writes selected files to the live root with post-read verification and attempted snapshots. It then invokes behavioral validation and rolls back on failed/unavailable/skipped checks. A transaction persists proposal lifecycle, apply journal, audit, and events.

The call chain has a critical mismatch: the delivery workspace is created and overlaid, but `runRepairValidation` is called with `resolvedRoot`, the live project root, rather than the delivery workspace root. The resulting validation can exercise a different tree. Sequential live-root writes plus compensating rollback are also not crash-atomic.

### 6. Durable state, recovery, and UI

`lib/db/src/schema/ai_executions.ts` stores queued/running/paused/cancelling/cancelled/completed/failed state, worker lease, heartbeat, checkpoint/version, request, operation/proposal/workspace/revision identity, and terminal linkage. `checkpointAiExecution` requires worker ownership, running status, and a strictly newer sequence; checkpoint contents are bounded and cannot redefine plan scope/dependencies/profile. Startup reconciliation pauses interrupted AI executions. The dashboard tracks execution identity and an opaque token, polls state, hydrates local state, and can obtain a replacement token for paused/failed execution.

There are still semantic and race gaps. `recoverAiExecutionResumeToken` unconditionally replaces the token hash for paused/failed rows; two concurrent recovery calls invalidate the first returned token. Chat checkpoint writes are best-effort in the stream path, so a rejected checkpoint can leave the UI ahead of durable state. A database `paused` state, a `client_disconnected` checkpoint stage, and dashboard “failed is resumable” semantics are not one unified state vocabulary. Task lifecycle has durable leases but does not wire cancellation to the in-flight provider call.

### 7. Git and workflow delivery

`routes/git.ts` scopes read operations by project access and commit/push by write access. Generic commands use `execFile` with bounds. AI proposal commit checks applied lifecycle, successful apply evidence, exact content/no drift, no unrelated staged or worktree changes, and stages only scoped paths. Push checks that the recorded commit is `HEAD`, uses a credential-free GitHub remote form, and queues a post-push scan.

Workflow CRUD and execution transitions are transactional. `/advance`, failure, retry, and rollback use an advisory lock and atomic state guards. AI workflow orchestration chooses a decision but does not itself constitute an autonomous phase worker; actual advancement remains an explicit endpoint/state transition. Therefore workflows are a coordination substrate, not evidence of a complete autonomous agent loop.

### Realistic bug-fix trace

For “find the null handling bug in the API, update the handler and test, run checks, repair any failure, and deliver it” the current path is:

1. The user submits chat. Auth and project ownership are checked; context is assembled from scan/graph/task/event state.
2. The agent reads/searches files and may run read-only Git tools. The model can produce a multi-file implementation plan with bounded file scope.
3. Build handoff requires the stored approved plan and approval flags. The agent can queue `replace_text`/`write_file` changes, but those changes remain pending.
4. Registered command, test, typecheck, or browser profiles can run, with bounded output and evidence. A failed check can drive a bounded repair node if the plan and profile allow it.
5. Apply requires a separate guarded request. It creates an isolated delivery workspace and preflights content, but writes the live root and validates the live root rather than the isolated delivery artifact. At this point the scenario becomes unsafe for a claim that the tested artifact is the artifact delivered.
6. A successful apply can be committed only through the guarded Git route; push is another explicit action. A crash during sequential apply can leave partial files, and a restarted task is not automatically re-executed because provider credentials and partial changes require a deliberate recovery decision.

Thus autonomous inspection/planning and bounded repair are real partial capabilities. Autonomous end-to-end delivery is stopped at approval and, if approval is given, has a verified workspace/validation integrity break.

## Capability Matrix

Each row is a finding. Status values are limited to **implemented**, **partial**, **missing**, **unsafe**, and **cannot verify**.

| Capability / classification | Evidence (file → symbol → path / side effect) | Current behavior; requirement; gap | Severity | Required change | Status |
|---|---|---|---|---|---|
| Auth and project isolation / boundary failure | `requireAuth.ts` → middleware; `requireProjectAccess.ts` → `loadProjectByIdForUser`; `app.ts` → API middleware | Requests are authenticated and owner-scoped before most project effects. Requirement is authorization at every crossing. Some graph routes query entity existence before ownership, allowing existing-vs-missing ID distinction. | medium | Authorize project before entity existence query and normalize not-found/forbidden semantics. | unsafe |
| Root and filesystem containment / boundary failure | `project-root.ts` → `establishProjectRoot`; `scan-runner.ts` → `performScan`; `path-validation.ts` → root policy | Current scans re-establish and fail closed, and file tools use lexical/realpath checks. In non-Replit configuration, blocked prefixes depend on `REPLIT_DEV_DOMAIN`, so broader host paths can pass. | high | Make the safe root policy explicit and environment-independent; test symlink/rebind and non-Replit deployment modes. | unsafe |
| Scanner and graph repository intelligence / partial capability | `file-walker.ts` → `walkProject`; `graph-extractor.ts` → `extractGraph`; `scan-runner.ts` → `performScan` | Bounded scan, metrics, graph, stale pruning, and provenance are implemented. Complete semantic understanding, incremental freshness, and legacy-row provenance are not established. | medium | Add revisioned incremental indexing and completeness signals consumed by planning; preserve legacy unknowns. | partial |
| Context snapshot / state inconsistency | `context-loader.ts` → project context transaction; `buildProjectContext` callers | Reads are project-scoped and bounded, but context contains multiple derived sources and cache invalidation is call-site dependent. A plan can be built from a stale/mixed snapshot. | medium | Persist context revision/manifest with each operation and reject plans against stale revisions. | partial |
| Task contract and objective binding / partial capability | `tasks.ts` schema; `task-execution-service.ts` → request construction; `chat.ts` → objective/plan gates | Tasks carry prompt, files, dependencies, retry and verification fields. The contract does not prove semantic acceptance criteria or complete test coverage for the requested defect. | high | Require machine-checkable objective, target paths, expected behavior, and acceptance checks before execution. | partial |
| Planning and dependency-aware execution / partial capability | `chat-agent.ts` → execution plan; `execution-node-coordinator.ts` → `executeExecutionNodePlan` | Server-owned scopes/dependencies/profile and bounded waves exist. Planning still stops for approval and cannot prove every cross-file semantic edge. | high | Make plan a durable operation artifact with revision, claims, evidence, and executable repair transitions. | partial |
| File mutation safety / implemented capability | `file-tools.ts` → `safePath`/`executeFileTool`; `tool-policy.ts` → approval policy | Model writes are deferred, path/symlink/destructive checks run, and apply requires exact approved subset. | high | Retain controls while moving writes into the operation workspace first and making promotion atomic/recoverable. | implemented |
| Shell/build/test execution / boundary failure | `execution-tools.ts` → registered profiles; `execution-kernel.ts` → bounded spawn | Server profiles, `shell:false`, cwd containment, timeout, output bounds, and process-group cleanup are present. cwd validation and spawn are check-then-use, leaving a TOCTOU edge. | medium | Pin or revalidate workspace/cwd immediately before and during execution; record profile revision. | unsafe |
| Validation and browser proof / partial capability | `ai-repair-validation.ts` → `runRepairValidation`; `browser-preview-verification.ts` → preview contract | Fixed profiles and bounded browser evidence are implemented; unavailable/failed cannot become passed. | high | Validate the exact immutable operation workspace and bind evidence to its content hash. | partial |
| Delivery workspace integrity / boundary failure | `delivery-workspace.ts` → `createDeliveryWorkspace`; `chat.ts` → apply path | Workspace is copied and overlaid, but behavioral validation receives `resolvedRoot`, not workspace root. | critical | Make workspace root the only validation target before promotion; refuse mismatched roots. | unsafe |
| Apply crash consistency / state inconsistency | `chat.ts` → sequential `fs.writeFile` and rollback; apply journal transaction | Compensating snapshots handle ordinary failures; kill/crash can interrupt writes before rollback and leave unknown state. | critical | Promote a fully validated workspace via atomic rename/swap or durable per-file commit protocol with recovery. | unsafe |
| Provider fallback and model output / partial capability | `ai-route-helpers.ts`; `chat-agent.ts`; route parse gates | Fallback and structured parse errors are bounded and surfaced. Live provider behavior, latency, and model quality are not source-verifiable. | medium | Add durable attempt receipts and explicit provider/model capability contracts. | cannot verify |
| Cancellation / boundary failure | `ai-execution-state.ts` → `requestAiExecutionCancel`; `task-execution-service.ts` → provider call | Chat has controller registration; task lifecycle calls provider without an AbortSignal/controller. A cancelled task call may continue and race finalization. | high | Thread cancellation through task provider/fallback/tool/validation calls and gate terminal writes on ownership/cancel state. | unsafe |
| Retry, lease, and checkpoint recovery / state inconsistency | `ai-execution-state.ts` → claim/checkpoint/recover; `job-reconciliation.ts` → restart handling | Durable leases and monotonic checkpoints exist. Resume-token rotation is last-writer-wins; chat checkpoint persistence can be best-effort; task crash recovery returns to verifying rather than autonomous continuation. | high | CAS token recovery, make checkpoint failure terminal/visible, and define one recovery state machine. | partial |
| Audit, events, and retention / partial capability | `audit.ts` → outbox; `startup-migrations.ts` → retention; route journals/events | Durable audit retries and bounded redacted retention exist. Retention intentionally removes old operational traces, so an old audit is not a complete transcript. | medium | Bind receipts/evidence to operation/revision and export explicit completeness/retention status. | partial |
| Memory and history / partial capability | `chat.ts` → memory enrichment/write; persisted messages/executions | Conversation and selected memories exist; durable operational history is bounded and split across messages, executions, task logs, events, and audit. | medium | Introduce an operation-centric evidence index over existing records; do not duplicate raw transcripts. | partial |
| Workflow autonomy / missing capability | `routes/workflows.ts` → start/advance/fail/retry/rollback; `routes/ai/workflows.ts` → orchestrate | State machine transitions are guarded, but orchestration only returns a decision; no autonomous worker executes all phases and repairs. | high | Add durable workflow-operation linkage and worker-driven phase execution using existing leases and profiles. | missing |
| Git commit/push delivery / partial capability | `routes/git.ts` → AI commit/push guards; `git-tools.ts` read-only tools | Guarded user/API delivery exists and checks content/evidence/HEAD. The model cannot independently commit/push, and production success is not source-verifiable. | high | Treat commit/push as terminal operation nodes with durable receipts, explicit policy, and resumable recovery. | partial |
| End-to-end Replit-Agent parity / cannot verify | No source contract can establish undocumented comparator internals; current routes terminate at approval/guarded delivery | Requirements comparable to another product must be measured by observable behavior, not marketing or names. No retained live campaign proves parity. | critical | Define an observable acceptance suite and run opt-in isolated provider/deployment campaigns. | cannot verify |

## Critical Boundary Findings

1. **AI → tool:** The server owns tool names, profiles, operation scope, and approval state. This is a good boundary. Residual risk is model claims and incomplete per-call durable evidence; untrusted text must never authorize a tool.
2. **Tool → filesystem:** Read tools are contained; writes are deferred and apply rechecks scope. The apply promotion is not crash-atomic, and command cwd has a check-then-use race.
3. **Filesystem → database:** Scan results are transactionally persisted after a rooted walk, with project correlation. Apply filesystem writes and DB journal are not one transaction; a process loss can separate them.
4. **Project → task/execution:** Task ownership and AI execution user/project fields are present, but the task service creates an execution then separately claims the task. A claim failure terminalizes execution; recovery and task state can still diverge unless reconciled.
5. **Scanner/graph → context/plan:** Bounded, project-scoped data flows into context, but completeness and revision are not a single authoritative input. A stale cache or mixed derived state can produce a valid-looking plan for an old tree.
6. **Plan → apply:** Exact proposal subset and approved plan checks are strong. They intentionally require human approval, so this is not an autonomous loop. Generated-file policy is not a complete code-level denylist; prompt instructions alone are insufficient.
7. **Apply → validation:** This is the critical unsafe crossing. `createDeliveryWorkspace` produces an isolated candidate while `runRepairValidation` receives the live root. A pass is therefore not proof about the candidate being promoted.
8. **Validation → final state:** Failed/unavailable validation rolls back the attempted apply and prevents applied state. Ordinary failure is covered; crash recovery and unknown partial filesystem state are not.
9. **Provider → retry:** Fallback avoids some transient failures, but task cancellation is not threaded into provider execution and live behavior cannot be verified. A retry must retain attempt identity and avoid duplicate side effects.
10. **Session/UI → durable state:** Local storage and polling can restore a client pointer, but token recovery is last-writer-wins and stale local state can survive a tab/process crash. UI state is not authoritative.
11. **Workflow → execution:** Workflow transitions are serialized and safe, but AI orchestration returns a decision rather than driving a durable worker. Manual endpoints remain the continuation mechanism.
12. **Execution → Git:** AI commit/push are separate guarded API actions and read-only model Git tools are intentional. Applied content, operation identity, and `HEAD` checks reduce scope escape, but delivery success under a real remote is **Cannot Verify From Current Source**.
13. **Audit/export → user:** Redacted projections and owner checks exist. Execution-owner-only export is narrower than project-access policy, and legacy correlation gaps can yield incomplete timelines; completeness must be explicit.

## Missing Autonomous Agent Loop

The missing capability is not another chat endpoint or another tool. It is a durable control loop with one authoritative operation identity:

`intake → authorize → snapshot → inspect → plan → approve/policy decision → prepare isolated workspace → apply candidate → validate candidate → diagnose → bounded repair → revalidate → promote → commit/push policy decision → verify delivery → terminal receipt`.

Current source implements many of the verbs, but they are split across chat, task, workflow, proposal/apply, validation, and Git routes. The model can propose pending changes; the apply route can promote them after a separate request; workflows can advance only through explicit endpoints; task restart recovery does not automatically resume provider work. There is no single state machine that owns all these transitions and proves that the validated bytes are the bytes delivered.

The loop must also distinguish:

* **Evidence:** what a tool or validator observed, including revision and content hash.
* **Policy:** what the server allowed, including user/project authorization and profile.
* **State:** what durable operation/task/proposal/workflow rows say.
* **Effect:** what bytes/processes/Git refs actually changed.

Recommendations must extend `ai-executions`, `task-execution-service`, `execution-node-coordinator`, validation profiles, delivery workspace, audit outbox, and Git guards. A new broad “agent service” would duplicate existing ownership and create another source of truth.

## Target Architecture

Use `ai_executions` as the operation control plane and link, rather than replace, task, proposal, workflow, audit, and delivery rows.

1. **Operation contract:** immutable project/session/task/request/revision/objective plus a server-generated plan hash and policy/profile revision.
2. **Execution graph:** existing execution nodes gain explicit inspect, mutate-candidate, validate, repair, promote, commit, and push node types. Node scopes and dependencies remain server-owned.
3. **Candidate workspace:** every mutation occurs in an operation-scoped workspace with marker, base hash, changeset hash, and lifecycle. Validation and browser preview consume this exact root.
4. **Promotion boundary:** after candidate validation, promotion uses atomic workspace replacement where possible or a durable recovery protocol; the live root is never the test target before promotion.
5. **Repair loop:** validation failures become bounded, evidence-linked repair inputs. A repair cannot enlarge scope or change profiles without a new policy decision.
6. **Unified recovery:** leases/checkpoints/resume token CAS cover provider, tool, validation, workspace, and delivery states. Crash reconciliation chooses resume, block, or manual recovery explicitly.
7. **Delivery:** commit/push remain policy-controlled terminal nodes, with exact content hash, expected `HEAD`, remote identity, and durable receipt.
8. **Evidence index:** use existing audit/events/checkpoints/logs/journals and add only correlation/index fields needed to reconstruct operation history and completeness.
9. **Client projection:** Dashboard reads server state and receives a reconciliation projection; local storage is a cache, never an authority.

## Gap-to-Implementation Map

| Gap | Extend existing mechanism | Dependency order | Rollback/migration |
|---|---|---|---|
| Candidate validated on live root | `delivery-workspace.ts`, `ai-repair-validation.ts`, apply route | P0, before autonomy | Feature flag candidate validation; pending proposals remain pending if disabled; no destructive migration |
| Crash-unsafe promotion | Delivery workspace lifecycle, apply journal, startup reconciliation | P0 | Keep old pending proposals; recovery marks uncertain operations blocked |
| Task cancellation race | `task-execution-service`, provider/fallback and execution controller | P0 | Add nullable controller/lease semantics; old rows reconcile conservatively |
| Root policy and command TOCTOU | `project-root.ts`, `path-validation.ts`, `execution-kernel.ts` | P0 | Reject newly unsafe roots; do not rewrite persisted roots |
| Unified operation/plan/revision | `ai-execution-state`, execution nodes, task/proposal links | P1 after P0 | Add nullable fields/backfill links only where correlation is certain |
| Durable repair loop | execution-node coordinator + validation profiles | P1 | Disable new node types and leave existing proposals usable |
| Workflow worker linkage | workflow execution rows + AI execution leases | P1 | Existing explicit endpoints remain authoritative |
| Delivery receipts and evidence index | audit outbox/events/journals/Git guards | P2 | Additive records; preserve old exports with incomplete marker |
| Scale/incremental context | scanner/graph/context cache | P2 | Fall back to full scan on revision mismatch |
| Empirical parity campaign | validation scripts and isolated release workflow | P3 | No production behavior change |

## Phased Implementation Roadmap

### P0 — integrity and security

* Make candidate workspace the sole validation target and bind validation to changeset/base/revision.
* Replace sequential live-root promotion with atomic or recoverable promotion; add startup handling for “promotion uncertain.”
* Thread cancellation through task provider, fallback, tool, command, browser, and validation calls.
* CAS resume-token recovery and make checkpoint persistence failure visible/terminal for required checkpoints.
* Enforce environment-independent root policy and narrow the command cwd race.
* Add graph anti-enumeration and subgraph response caps.

### P1 — autonomous capability

* Extend the existing node coordinator into a durable inspect/plan/candidate/validate/repair/promote graph.
* Bind objective contracts and acceptance checks to plan and evidence.
* Link workflow phases to AI executions without bypassing workflow transition locks.
* Allow policy-configured unattended promotion only after candidate evidence, while preserving explicit approval for higher-risk changes.

### P2 — reliability and scale

* Add operation-centric evidence projections over existing records.
* Improve incremental scanner/graph/context revisions and cache consistency.
* Add durable process/output receipts and cross-instance recovery tests.
* Make Dashboard projections reconcile local cache and server state across tabs/restarts.

### P3 — optimization and empirical comparison

* Run opt-in isolated provider/browser/deployment campaigns across representative repositories.
* Tune budgets, model selection, context retrieval, and parallel waves from observed data.
* Compare only observable acceptance outcomes; do not infer undocumented comparator internals.

## Detailed Patch Plan

| ID | Files/symbols | Current → required | Why / risk | Dependencies and tests | Acceptance evidence |
|---|---|---|---|---|---|
| P0-1 | `chat.ts` apply; `ai-repair-validation.ts`; `delivery-workspace.ts` | Validate `resolvedRoot` → validate immutable candidate workspace | Current pass can describe different bytes; critical integrity risk | Depends on workspace marker/hash. Unit path tests; integration overlay/validation; E2E apply; failure test wrong-root rejection | Validation receipt contains workspace root identity, base/changeset hash, and candidate bytes match promoted bytes |
| P0-2 | delivery workspace, apply journal, startup reconciliation | Compensating rollback → atomic/recoverable promotion | Crash can leave partial live files | Unit crash states; integration kill between files; restart/chaos; stale workspace cleanup | Every interrupted promotion ends `blocked` or `completed`, never ambiguous live state |
| P0-3 | task lifecycle, provider fallback, execution controller | No task AbortSignal → owned cancellation propagation | Cancelled provider may finalize later | Unit abort; integration provider hang; concurrent cancel/finalize; E2E retry | Cancel causes provider/process stop and no later success transition |
| P0-4 | `ai-execution-state.ts` recovery/checkpoint; chat stream | Last-writer token and swallowed checkpoint → CAS and required failure state | Resume race and false live progress | Concurrent token test; crash/reconnect; checkpoint DB failure | One recovery token wins deterministically; client sees durable incomplete state |
| P0-5 | `path-validation.ts`, `project-root.ts`, `execution-kernel.ts` | Conditional host policy/check-then-use → explicit policy/revalidation | Host escape and TOCTOU | Unit non-Replit paths/symlink replacement; integration command race | Unsafe roots rejected independent of deployment env; command cannot escape |
| P1-1 | execution node coordinator, task service, chat plan | Split route lifecycle → one durable operation graph | Enables repair without duplicate subsystem | Unit transitions; integration multi-file plan; provider/tool/build/test failure; concurrency | One operation links plan, nodes, evidence, candidate, and terminal receipt |
| P1-2 | objective schemas, proposal gates, context manifest | Prose objective/revision → machine-checkable contract | Prevents unverifiable “fixed” claims | Schema/unit; integration stale revision and missing acceptance; E2E | Completion rejected without objective, target, acceptance, and matching evidence |
| P1-3 | workflows routes/execution state | Decision-only orchestration → leased phase worker | Removes manual continuation gap | Unit safe transitions; integration phase crash/retry; E2E workflow repair | Phase execution has operation ID, lease, evidence, and exactly-once transition |
| P2-1 | audit outbox, events, journals, export projection | Fragmented history → correlated completeness projection | Retention and split records obscure truth | Unit redaction; integration retention boundary/retry race; export E2E | Export states retained/missing evidence without inventing transcript |
| P2-2 | dashboard AI/Flight Deck state | local authority → reconciled server projection | Prevents ghost pending/terminal UI | Browser reload/tab race; SSE EOF/abort; stale pointer | UI converges to server terminal state after reload and reconnect |
| P2-3 | scanner/graph/context | Full/stale derived reads → revisioned incremental snapshot | Better planning freshness/scale | Scanner unit; graph stale/deleted files; context concurrency | Operation records complete manifest or explicit incomplete verdict |
| P3-1 | release validation scripts/workflow | No source proof of parity → observable campaign | Comparator behavior cannot be inferred | Isolated provider/browser/deployment, including all required failure modes | Reproducible metrics for inspect/plan/repair/validate/deliver; no marketing claim |

Migration strategy for all additive fields is nullable/backward-compatible. Backfill only when the existing correlation and ownership are unambiguous. On rollback, disable new transitions, preserve existing terminal rows, and mark in-flight candidate/promotion operations blocked rather than guessing. No schema or application changes are part of this report.

## End-to-End Validation Plan

Validation must prove final side effects, not only helper behavior.

### Unit and static checks

* Root containment: absolute paths, traversal, symlinks, dead roots, non-Replit policy, null bytes, and cwd replacement.
* Tool policy: untrusted model arguments, missing approval, changed plan scope, generated/sensitive/script files, bounded output/time.
* State machines: every execution/node/proposal/workflow transition, stale worker, duplicate idempotency key, token CAS, monotonic checkpoint, cancellation.
* Candidate hashes: overlay, validation root, promotion root, and final file hashes.
* Redaction: provider output, shell output, paths, secrets, old retained traces, and export allowlists.

### Integration and database checks

* Concurrent create/claim/resume/cancel/checkpoint/finalize with identity-based dispatch and bounded readiness barriers.
* Provider timeout, malformed output, fallback failure, empty evidence, tool exception, build/test/process/database failure.
* Scan/discovery root disappearance, stale graph entities, graph cross-project IDs, context cache invalidation, and transaction rollback.
* Apply partial patch, stale base, duplicate path, validation unavailable/failed, promotion kill, restart reconciliation, and cleanup failure.
* Audit outbox retry/idempotency and correlation continuity across task, execution, event, journal, proposal, and Git rows.
* Retention at just-before/at/after 30- and 90-day boundaries, active/resumable protection, and incomplete export behavior.

### Browser and E2E journeys

1. New chat → inspect/search → approved plan → pending multi-file changes.
2. Candidate workspace overlay → test/typecheck/browser validation against the candidate root.
3. Validation failure → bounded diagnosis/repair → second validation; cap exceeded becomes blocked.
4. Disconnect, process restart, resume-token race, tab reload, and cross-tab reconciliation.
5. Apply/promotion → exact content verification → commit guard → push guard → post-push scan.
6. Workflow phase execution, failed phase retry, cancellation, and terminal receipt.

The release/browser workflow must remain opt-in for real providers and deployment. Screenshots, fixture names, and generated API contracts are not acceptance evidence by themselves. Each accepted result must include operation ID, revision, candidate/changeset hash, profile revision, terminal state, and retained evidence completeness. Live-provider, browser-in-deployment, and remote-push success remain **Cannot Verify From Current Source** until such an artifact is intentionally produced.

## Final Gap Count

Counts below are matrix rows, with one primary status and one primary severity per finding; categories are mutually exclusive for reconciliation.

| Severity | implemented | partial | missing | unsafe | cannot verify | total |
|---|---:|---:|---:|---:|---:|---:|
| critical | 0 | 0 | 0 | 2 | 1 | 3 |
| high | 1 | 5 | 1 | 2 | 0 | 9 |
| medium | 0 | 4 | 0 | 2 | 1 | 7 |
| low | 0 | 0 | 0 | 0 | 0 | 0 |
| **total** | **1** | **9** | **1** | **6** | **2** | **19** |

Primary classification reconciliation:

* **Missing capability: 1** — no durable autonomous workflow/phase worker that closes the full loop.
* **Partial capability: 10** — scanner/context, task contract, planning, validation, provider behavior, recovery, audit/history, Git delivery, and related capabilities that exist but do not establish the complete requirement.
* **Boundary failure: 6** — authorization enumeration, root policy, shell cwd, candidate validation, apply promotion, and cancellation where current behavior can violate the intended boundary.
* **State inconsistency: 2** — crash-unsafe apply and split execution/recovery semantics. These overlap the matrix’s unsafe severity but are counted by classification, not added to the severity total.

The report therefore identifies **19 primary capability findings**, including **3 critical**, **9 high**, **7 medium**, and **0 low**. It does not claim parity, production reliability, or successful external delivery without retained execution evidence.