# E2 Source-Derived Measurement Ledger

- **Updated:** 2026-10-07
- **Stage:** E2 only; E3 remains stopped. E4 remains under its existing gates.
- **Purpose:** Make E2 coverage measurable from source-discovered surfaces and invariants without deriving a denominator from test totals, `PROVEN` row counts, or a new Runtime catalog.
- **Current result:** Source-family completeness is `UNKNOWN`; no total denominator, percentage, or overall score is valid yet.

## Measurement rules

1. **Inventory completeness is independent from invariant evidence.** A source family is `CLOSED` only after its entrypoints, writers, consumers, and recovery paths have been enumerated and reviewed. Any family still `UNKNOWN` blocks a project-wide ratio.
2. **An evidence unit is one surface × one invariant.** Keep independently testable behaviors in separate rows. Do not award fractional credit to a mixed `PARTIAL` row.
3. **`PASS` is boundary-specific.** It requires source-linked evidence that tests the stated condition and scope. A test file's existence, a stored status, or an adjacent invariant is not enough.
4. **`FAIL` means a tested counterexample to that exact invariant.** `UNKNOWN` means evidence or inventory closure is missing; it does not mean the behavior is broken.
5. **No weights or aggregate score.** The number of rows and the number of passing rows are not a percentage.
6. **Stage state is not a coverage score.** `0/4` means zero of the four architectural layers is fully closed. It is not a progress fraction.

## Source census

The following are **observed source anchors**, not a claim that the census is exhaustive. Completeness is recorded separately for each family.

| Source family to enumerate | Observed source anchors | Completeness |
|---|---|---|
| Model/tool ingress, policy, and runners | `lib/ai-orchestrator/src/tool-operational-registry.ts`, `tool-policy.ts`, `tool-execution-engine.ts`, `agents/chat-agent.ts`, `agents/hierarchical-executor.ts`, `benchmark/provider-health-probe.ts`; `artifacts/api-server/src/routes/ai/*`, `lib/ai-route-helpers.ts`, `lib/task-execution-service.ts` | `UNKNOWN` — observed call edges are recorded below; all model ingress, exported-package consumers, routes, and indirect callers have not been closed |
| Task, Mission, workflow, and scheduler surfaces | `artifacts/api-server/src/lib/task-execution-service.ts`, `mission-runtime.ts`, `workflow-phase-execution.ts`; `artifacts/api-server/src/routes/ai/tasks.ts`, `missions.ts`, `workflows.ts` | `UNKNOWN` — direct admission and selected dispatch paths are known; the complete surface/caller set is not |
| Proof, acceptance, and evidence writers/consumers | `artifacts/api-server/src/lib/proof-foundation.ts`, `execution-proof.ts`, `ai-execution-acceptance.ts`, `ai-execution-state.ts`, `agent-state/observation-materializer.ts` | `UNKNOWN` — all producers, validators, projections, and consumers are not yet enumerated |
| Mutation and external-effect surfaces | `artifacts/api-server/src/routes/git.ts`, `routes/ai/*`, `lib/recipe-operation-runner.ts`, `lib/github-delivery-service.ts`, Apply and `agent-state/runtime-start*` modules | `UNKNOWN` — these are observed families, not an exhaustive mutation/effect list |
| Durable writers, startup recovery, and replay | `lib/db/src`, `artifacts/api-server/src/index.ts`, `lib/ai-execution-state.ts`, task/Mission recovery modules and integration tests | `UNKNOWN` — complete writer-to-recovery and replay-consumer edges are not closed |
| World State writers, transition consumers, and planning | `agent-state/world-state.ts`, `observation-materializer.ts`, `runtime-start-transition.ts`, `mission-auto-replan*`, `mission-runtime.ts` | `UNKNOWN` — selected transition and prompt-binding paths are evidenced; all readers, writers, and decision consumers are not |
| Dashboard/API client ingress and status projections | `artifacts/dashboard/src`, API route/client-contract sources, Mission/Task status projections | `UNKNOWN` — UI-originated paths and all status consumers have not been exhaustively mapped |

### Model/tool ingress inventory (observed, not closed)

The source search covered workspace TypeScript/TSX/JavaScript module sources, excluding tests, specs, `dist`, and `node_modules`, for `executeToolLoop`, `executeScopedReadTool`, `executeHierarchical`, `chatWithFallback`, `probeProviderHealth`, provider `.call` sites, and tool-definition options. The package export map and AI router composition were also inspected. These results establish the following edges, not a complete denominator:

| Surface × source edge | Observed source path | Boundary / unresolved scope |
|---|---|---|
| HTTP chat × request reaches the chat orchestrator | `routes/ai/chat.ts` handles `/api/ai/chat` and `/api/ai/chat/stream` and calls `chatWithFallback`; `lib/ai-route-helpers.ts` selects providers, performs capability preflight when applicable, then calls exported `chat()` | The two route callsites are observed. Other AI route families and all model-only ingress are not closed |
| Durable Task repair × request reaches the chat orchestrator | `lib/task-execution-service.ts` calls `chatWithFallback` for the non-recovery path and supplies server-owned tool names, read scope, approval state, and invocation callbacks; `routes/ai/tasks.ts` exposes Task execution and `lib/mission-runtime.ts` schedules it | Establishes a Task/Mission call edge only; it does not close Task/Mission admission, scheduler, recovery, or worker execution surfaces |
| Scan analysis / code review × single-shot model ingress | `routes/ai/analysis.ts` exposes analyze, review, and their streaming variants; the four handler paths call `runAgentWithFallback` around `analyzeScan` or `reviewCode`; `agents/scan-analyst.ts` and `agents/code-reviewer.ts` use `BaseAgent`, which calls `agentComplete` | These reviewed agent paths use single-shot completion rather than `executeToolLoop`; provider/model fallback does not add tool execution. The separately named `structuredExecution.complete` calls in this route persist the structured result and are not model calls |
| Workflow orchestration × single-shot model ingress | `routes/ai/workflows.ts` calls `orchestrateWorkflow`; `agents/workflow-orchestrator.ts` calls `agentComplete` and may retry once with relaxed structured-output hints | Model-only decision path; phase execution is a separate workflow/runtime surface and is not closed by this call edge |
| Provider-key save × credential-validation model probe | `routes/ai/providers.ts` validates keys through `validateProviderKey` before persistence; `agent-complete.ts` documents and performs a minimal provider probe | A provider request, but not an agent tool loop. Provider aliases share the same handler; other lifecycle/catalog probes are not enumerated here |
| Chat execution × tool-loop entrypoints | `agents/chat-agent.ts` contains three direct `executeToolLoop` callsites (main, child execution-node, and replan); `agents/hierarchical-executor.ts` contains one direct callsite for subtasks and is invoked by `chat-agent.ts` | Four literal callsites were found in the searched non-test source roots. This callsite count is not a denominator or proof that every dynamic/indirect execution path is represented |
| Chat execution × scoped read runner | `agents/chat-agent.ts` calls `executeScopedReadTool`; that helper dispatches through `executeSingleTool` | The call edge is observed; other callers or alternate read paths are not established by this count |
| Hierarchical execution × synthesis is tool-free | `agents/hierarchical-executor.ts` runs each subtask through `executeToolLoop`, then calls `strategy.call` for final synthesis without a `tools` option | This excludes only that synthesis call from the tool-enabled path; other direct provider calls remain part of the unresolved model-ingress inventory |
| Capability preflight × provider health tool call | `lib/ai-route-helpers.ts` invokes `probeProviderHealth` with `getCapabilityProbePreflightTools(["read_file"])`; `benchmark/provider-health-probe.ts` sends `benchmark_health_probe` plus optional `additionalTools`, then uses a separate structured-output call without tools | Provider preflight is a separate model/tool surface. Direct benchmark and smoke callers also exist in `lib/ai-orchestrator/src/benchmark/live-code-agent-benchmark.ts`, `artifacts/api-server/src/lib/ai-code-agent-benchmark.ts`, and `artifacts/api-server/scripts/run-live-openrouter-free-smoke.mjs`; they are harness paths, not additional chat HTTP routes |
| Tool policy × provider manifest and invocation authorization | `tool-policy.ts` builds provider definitions from file, git, execution, navigation, package, binary, and analysis definitions; `chat-agent.ts` resolves policy and filters manifests; `tool-execution-engine.ts` performs invocation checks; `tool-operational-registry.ts` asserts definition/metadata name parity at module load | These are the current policy and operational-metadata boundaries. `tool-surface.ts` is a distinct capability-family catalog and is not treated as the complete provider-tool denominator |
| Tool invocation × executor dispatch | `tool-execution-engine.ts` dispatches through file, git, navigation, package, binary, validation, command, analysis, and browser-validation executors | The dispatch families are observed; indirect calls, API-only model paths, and external package consumers remain unresolved |
| Public package × orchestration and raw provider entrypoints | `lib/ai-orchestrator/package.json` exports the package root and selected subpaths; `src/index.ts` exports `chat`, `agentComplete`, `completeRaw`, provider strategy access, tool policy APIs, and provider-health probing; `groq-client.ts` documents `completeRaw` as accepting tool definitions | `completeRaw` delegates execution to its caller. The repository callsite search does not prove there are no runtime, dynamically loaded, or out-of-workspace consumers of these public entrypoints |

The search found additional direct `strategy.call` and `strategy.stream` sites in chat recovery/correction paths and query planning. Their call options are not all tool-enabled; they are intentionally not added to the tool-loop count. Direct `chat()` benchmark callers include `lib/ai-orchestrator/src/benchmark/forensic-benchmark.ts` and `live-code-agent-benchmark.ts`. The AI router also mounts `analysis`, `workflows`, `benchmark`, `recipe`, `missions`, provider-management, and operator-alert subrouters. The inspected analysis, workflow, and provider-key routes now have the call edges above; benchmark scorecard reads and operator-alert/budget routes are not model calls in the inspected handlers. Recipe and Mission dispatch/recovery paths, other provider lifecycle/catalog calls, direct model-only service paths, and out-of-workspace package consumers still need reconciliation before the broader model/tool ingress family can close.

### What closes a source family

For each family, record the search method and reviewed result for:

- all route and client entrypoints, including generated or indirect call paths;
- all exported tools/capabilities, runners, and callers;
- all relevant database and filesystem writers, plus readers and final decision consumers;
- all durable queue, lease, startup reconciliation, retry, replay, and cleanup edges;
- all external-effect boundaries and their before/after evidence paths;
- explicit exclusions and why they are outside E2.

Only then may that family move from `UNKNOWN` to `CLOSED`. The census itself is documentation derived from source references; it must not become a runtime permission catalog or duplicate the existing registries.

## Atomic E2 evidence register

Statuses below apply only to the invariant as written. Historical results are identified as such and are not represented as tests rerun in this update.

| Surface × invariant | Status | Evidence and exact boundary | Not established |
|---|---|---|---|
| Direct Task admission × completed prerequisite without current Canonical Proof is rejected before execution | `PASS` | DB-backed cases in `artifacts/api-server/src/lib/task-execution-lifecycle.integration.test.ts`; the progress log records the denied case and the matching current-proof allow case | Scheduler wake, duplicate dispatch, and general Task/Goal/Mission parity |
| Direct Task admission × matching current Canonical Proof permits the linked Task attempt | `PASS` | DB-backed current-proof case in `task-execution-lifecycle.integration.test.ts`; the prior record explicitly keeps Goal/Mission completion separate | Scheduler and downstream completion |
| Mission dependent Task × a `GitPushed` event without Mission acceptance does not wake the successor | `PASS` | `mission-runtime-recipe.test.ts`, test “releases a dependent Goal only after the GitHub delivery proof is current”; first wake returns zero and the successor stays blocked | Any other event family or dependency type |
| Mission dependent Task × current delivery proof wakes and queues exactly once | `PASS` | Same DB-backed test: matching execution/attempt, Canonical acceptance, recipe receipt, Episode, and active plan revision; one scheduler call and one `AiGoalDispatchRequested` event | The actual task worker is mocked; this is scheduler/dispatch-request proof, not task execution or completion |
| Mission dependent Task × a repeated wake after successful dispatch does not enqueue again | `PASS` | Same test calls `wakeReadyMissionGoals` again; it returns zero, scheduler call count remains one, and the dispatch event count remains one | Concurrent multi-worker wake races |
| Apply × documented startup crash windows W0–W4 do not create false success | `PASS` | Scoped process-recovery evidence recorded in `agent-core-forensic-status-report.md` §5.3 | HTTP-route coverage for every window and other mutation surfaces |
| Apply route × crashes in documented W5–W7 windows fail closed without false success | `PASS` | Scoped DB/process evidence recorded in `agent-core-forensic-status-report.md` §5.3 | Unlisted crash windows, other surfaces, and general external-effect reconstruction |
| Apply route × replay after committed W8 response loss does not duplicate the applied result | `PASS` | Scoped DB/process evidence recorded in `agent-core-forensic-status-report.md` §5.3 | Unlisted crash windows, other surfaces, and general external-effect reconstruction |
| `runtime.start` × current transition proof releases its bound successor | `PASS` | `runtime-start-transition.test.ts` and `mission-runtime.test.ts`; recorded as two DB-backed cases in the progress log | Managed supervisor behavior and all runtime crash windows |
| Manual `/git/push` × no synthetic AI execution, Episode, or World Transition is created | `PASS` | `routes/git.test.ts`; scoped route evidence recorded in the progress log and status report | Live GitHub provider behavior |
| Manual `/git/push` × its linked scan reaches a durable terminal state | `PASS` | `routes/git.test.ts`; local safe-root fixture and linked scan completion recorded in the progress log | Other scan ingress and non-fixture repository environments |
| Verified GitHub delivery × process loss around remote effect and receipt is reconciled/idempotent | `PASS` | Local HTTP/bare-remote fixtures in `github-delivery-races.integration.test.ts` and `github-delivery-process-recovery.integration.test.ts`; see status report §5.3 | Live GitHub, all remote failure modes, and all delivery consumers |
| World Fact × accepted revision is bound to the replan prompt | `PASS` | DB-backed `mission-auto-replan-evidence.integration.test.ts`; documented result verifies revision/prompt binding | A relevant fact changing the selected plan action |
| World Fact × relevant change alters the planner's action | `UNKNOWN` | No accepted evidence found in the current status report | Must be evaluated as its own invariant; prompt inclusion is not action-change proof |

This register intentionally has no numerator or denominator. Its rows are known evidence units, not a closed inventory of every E2 unit.

## Stage state

| Stage | State | Scope rule |
|---|---|---|
| E2 | `ACTIVE` | Continue bounded source census and evidence work only |
| E3 | `STOPPED` | Do not start implementation before the E2 gate explicitly passes |
| E4 | `OPEN / NOT PASS` at the existing E4.1 boundary | Keep later qualification, evaluation, collection/calibration, and promotion behind their existing gates |

The four architectural layers in the status report remain `0/4` **fully closed**. This records layer closure only; it is not a test-based or row-based progress ratio.

## Next census boundary

Continue closing one source family at a time. For model/tool ingress, reconcile recipe and Mission dispatch/recovery, remaining provider lifecycle/catalog paths, direct model-only service paths, and public-package consumers before changing `UNKNOWN`; then inventory proof/acceptance producers and consumers. Split each mixed behavior into atomic surface × invariant rows. Keep every unresolved family `UNKNOWN`; do not publish an overall percentage until the full E2 source population is closed.
