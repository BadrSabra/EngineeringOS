# EngineeringOS Decision Intelligence — G0 Forensic Audit

**Audit date:** 2026-11-03  
**Repository revision inspected:** local `main` at `0b67a01`  
**Workspace state at inspection:** clean; local `main` was 14 commits ahead of the cached `origin/main` reference. No remote fetch was performed, so this does not assert the current GitHub branch head.  
**Scope:** repository implementation and existing test evidence only. No API workflow, database, live AI provider, GitHub API, or production system was used. No product code was changed during G0.

## 1. Executive result

EngineeringOS already has a bounded Mission recovery path, server-owned diagnosis and evidence checks for selected failure types, deterministic strategy selection, durable plan-revision materialization, dependency-aware Goal dispatch, execution acceptance, direct effect observation, World Transition persistence, and recovery reconciliation.

That is a useful base for Decision Intelligence, but it is not yet a complete decision-evaluation system:

- The new Mission strategy engine is specialized to runtime-start and validator recovery; it is not a general strategy generator.
- Its scores are fixed policy calculations, not empirically calibrated outcome predictions.
- Strategy evidence influences the final plan for supported cases, but the underlying general planner still builds its base plan from the Mission intent/objective and turn intent. Replan context is attached as advisory context; specialized strategy code then changes the plan for supported cases.
- A selected decision is durably embedded in each materialized plan snapshot and bound into the revision hash. There is no dedicated Mission Decision Trace or post-execution Strategy Outcome record.
- Existing chat `decision_trace` and model-selection trace are different contracts; neither is a substitute for a durable Mission strategy decision and outcome record.
- Existing benchmark/release baselines measure other capabilities. They do not establish a paired Mission-strategy quality baseline.
- G0 is complete as an audit. G1 remains unestablished until a reproducible Mission-specific baseline is measured and its unavailable metrics are explicitly marked.

Therefore the correct overall classification is **PARTIAL**, not “Decision Intelligence implemented,” “strategy superiority proven,” or “learning achieved.”

## 2. Architecture map and component ownership

| Capability | Current owner and source | Actual responsibility |
|---|---|---|
| Mission and general plan construction | `lib/ai-orchestrator/src/mission-planning.ts:394`; `lib/ai-orchestrator/src/task-planner.ts:355` | Builds a read-only plan preview from intent/objective and existing durable planning state. The preview attaches sanitized replan context; that context does not itself rewrite the base plan. |
| Failure diagnosis | `artifacts/api-server/src/lib/world-state-failure-diagnosis.ts:339`; `mission-auto-replan.ts:90-112` | Parses server-owned failure summaries and supported World State runtime diagnoses. Invalid persisted diagnosis fails closed. |
| Planning evidence | `mission-world-state-planning-read.ts:259`; `agent-state/runtime-start-hypothesis-replan-context.ts:233` | Loads scoped World State facts and prior runtime-start hypothesis/experiment evidence. These are advisory/historical context, not current proof or authority. |
| Strategy generation and selection | `mission-strategy-engine.ts:212`, `:368`, `:513` | Generates two bounded alternatives for each supported recovery family, evaluates with deterministic fixed rules, selects a plan delta, or returns blocked/not-applicable. |
| Replan orchestration | `mission-auto-replan.ts:519` | Locks the Mission; validates autonomy and failure state; verifies relevant accepted failure/evidence; builds a preview; applies the specialized strategy; materializes a revision in the transaction; dispatches root Goals afterward. |
| Plan and Goal materialization | `artifacts/api-server/src/routes/ai/missions.ts:1159` | Persists plan snapshots into Goal success criteria/outcome contracts, creates Goals/Tasks and dependency edges, and reuses existing Goals for a matching plan-revision hash. |
| Replan reconciliation | `mission-auto-replan.ts:848`; `job-reconciliation.ts:91`, `:959`, `:1117` | Finds durable `needs_replan` Missions and re-enters the coordinator after interruption. |
| Goal execution and acceptance | `mission-runtime.ts:2215` and the acceptance/proof helpers it invokes | Enforces Mission/Goal/dependency status, execution bindings, attempt identity, acceptance, and required evidence before terminal Goal projection. |
| Approval | `mission-approval.ts:60`; Mission routes | Explicit approval is a separate business operation. Strategy selection does not grant approval or capability. |
| Observation and World State | `agent-state/observation-materializer.ts`; `agent-state/world-state.ts`; `ai-world-transitions.ts` schema | Stores scoped observations and transition/effect evidence; materialization remains separate from accepting a strategy prediction as fact. |
| Chat forensic trace | `lib/ai-orchestrator/src/audit-telemetry.ts:133`; `tool-execution-engine.ts` and `chat-agent.ts` | Tracks chat/tool-loop verdict and evidence projection. It is not the Mission strategy decision ledger. |
| Model-selection trace | `lib/ai-orchestrator/src/openrouter/model-resolver.ts:142` | Emits a bounded model-routing trace to logs. It is neither durable Mission state nor strategy evaluation. |
| Benchmark/release infrastructure | `lib/ai-orchestrator/src/benchmark/*`; `scripts/validate-benchmark-baseline.ts`; `docs/baseline-governance.md` | Evaluates existing Code Agent/AI release contracts and approved baselines; it does not yet compare Mission strategies against a Mission-specific baseline. |

## 3. Actual execution-path map

1. A Goal execution records an acceptance outcome and may move the Goal/Mission to `needs_replan` (`mission-runtime.ts:745-767`, with additional guarded transition paths later in that module).
2. The durable reconciliation path calls `reconcileAutomaticMissionReplans` (`job-reconciliation.ts:959`, `:1117`), which selects eligible Missions and invokes `autoReplanMission`.
3. `autoReplanMission` locks the Mission row and selects the failed Goal. It rejects non-autonomous Missions, malformed or non-retryable diagnoses, approval-required failures, exhausted budgets, and ineligible replan states.
4. For the supported runtime path it binds the failure to the exact accepted failure, execution, attempt, Episode, plan revision, World Transition, and relevant direct observations (`mission-auto-replan.ts:180-330`). It also loads World State planning and hypothesis evidence.
5. The base `buildMissionPlanPreview` is constructed from Mission intent/objective plus runtime target and replan context (`mission-auto-replan.ts:666-672`; `mission-planning.ts:394`). The general task planner does not use the failure evidence as a general strategy search input.
6. For supported runtime and validator failures, `selectAndApplyMissionStrategy` adds or changes plan steps and dependencies (`mission-strategy-engine.ts:212-512`). Unsupported or unsafe input blocks selection.
7. The decision ID and planning inputs contribute to the replan hash. The Mission plan/Goals/Tasks/dependencies are materialized under the transaction; the Mission’s active revision and replan counters are updated (`mission-auto-replan.ts:704-765`).
8. Root Goals are dispatched after that transaction. The Mission status/event update occurs afterward (`mission-auto-replan.ts:767-835`). Thus durable creation and dispatch are deliberately not one database transaction; reconciliation and execution idempotency are important at this boundary.
9. Goal execution uses the existing Mission runtime, authorization, lease, acceptance, and proof pathways. Required direct observations and World Transitions are independently materialized and checked. Acceptance, observed effect, and World State projection remain separate claims.
10. The resulting failure/success can inform another bounded replan. There is no general persisted evaluator comparing the strategy’s predicted outcomes with the independent observed result.

## 4. Evidence provenance map

| Evidence class | Current source/binding | Authority limit |
|---|---|---|
| Failure diagnosis | Persisted Goal `outcomeContract` acceptance diagnosis or server-owned World State diagnosis | Invalid diagnosis is rejected; a diagnosis marked approval-required is not automatically retried. |
| Runtime failure evidence | Canonical acceptance → execution/attempt → closed Episode → World Transition and linked observation rows (`mission-auto-replan.ts:180-330`) | Requires matching project, Mission, Goal, revision, attempt, scope, freshness, completeness, provenance, and transition identity where applicable. |
| World State planning read | `loadMissionWorldStatePlanningRead` | Advisory context only. It does not replace direct fresh evidence at the execution boundary. |
| Historical hypothesis/experiment evidence | Runtime-start hypothesis evidence loader | Historical advisory evidence only; the Mission prompt expressly says it is not current-state proof or authorization (`missions.ts:1387-1393`). |
| Strategy evaluation | `MissionStrategyDecision.candidates` | Deterministic policy score and reason code; not a probability, calibrated confidence, or proof of predicted outcome. |
| Selected strategy | `MissionStrategyDecision` embedded in the plan snapshot | Bound to Mission, failed Goal, prior revision, supported evidence refs, selected plan delta, and resulting plan revision hash. |
| Execution/acceptance/effect | Execution acceptance, Episode, observations, World Transition, and canonical proof helpers | Each has independent scope and attempt bindings; a successful dispatch or plan selection is not acceptance. |
| Outcome comparison | No Mission-specific expected-versus-observed strategy outcome record located | NOT PROVEN. |

## 5. Persistence and transaction map

- Mission and Goal state: `lib/db/src/schema/ai_missions.ts`; plan snapshots currently live in Goal `success_criteria` and `outcome_contract` JSON.
- Execution attempts and statuses: `lib/db/src/schema/ai_executions.ts`.
- Acceptance records: `lib/db/src/schema/ai_execution_acceptances.ts`.
- Episode and observation provenance: `lib/db/src/schema/ai_agent_episodes.ts` and `ai_agent_observations.ts`.
- World Transition/effect records: `lib/db/src/schema/ai_world_transitions.ts`; World State is separately materialized.
- Replan materialization: row-locked transaction around Mission validation, plan hash, Goals/Tasks/dependencies, and active revision (`mission-auto-replan.ts:519-765`; `missions.ts:1159-1348`).
- Dispatch and terminal Mission status/event: after the materialization transaction (`mission-auto-replan.ts:767-835`).
- A repeated materialization of the same plan hash reuses matching Goals/Tasks rather than generating another plan (`missions.ts:1195-1263`). Existing tests check concurrent replanning and replay after the Mission has advanced. The exact crash boundary between durable materialization, external dispatch, and the final Mission status update is not independently proven by those tests.
- No dedicated `mission_decisions` or `strategy_outcomes` table/schema was found. Avoid adding one until G2 establishes whether the existing plan snapshot plus execution/effect records can satisfy durability, uniqueness, retention, and queryability requirements.

## 6. Existing capability matrix

| Capability | Status | Evidence and limits |
|---|---|---|
| Evidence-bound diagnosis for supported runtime failure | **PARTIAL** | Strong identity/provenance validation exists in `mission-auto-replan.ts`; only selected scenarios are handled. |
| Failure evidence affects a final Mission plan | **PARTIAL** | Runtime and validator strategy branches modify the plan; other diagnosis classes do not receive general strategy generation. |
| Distinct runtime/validator alternatives | **PARTIAL** | Two policy-labelled candidates are emitted and plan ordering/scope can differ (`mission-strategy-engine.test.ts:139-295`). There is no general semantic-equivalence analysis. |
| Deterministic scoring and selection | **PARTIAL** | Fixed utility formulas and stable tie-breaking exist; they are not calibrated against observed outcomes. |
| `NO_DECISION` contract | **NOT PROVEN** | The current union returns `selected`, `blocked`, or `not_applicable`; it does not expose a first-class `NO_DECISION` with reason/eligible-set contract. |
| Durable strategy decision | **PARTIAL** | Full decision is embedded in the immutable plan snapshot and bound to its revision; there is no independent decision record bound to the dispatched execution attempt. |
| Outcome evaluation | **NOT PROVEN** | No Mission Strategy Outcome Evaluator found that compares predicted effects/risks with independent observations and acceptance. |
| Shadow comparison | **NOT PROVEN** | No path was found that records a shadow strategy decision alongside the existing planner while guaranteeing no execution effect. |
| Controlled execution under existing safeguards | **PARTIAL** | Current bounded automatic replan exists and respects approval/proof/lease contracts for its supported paths. It is not a rollout that is gated by shadow-quality evidence. |
| Mission-specific verified improvement | **NOT PROVEN** | Current benchmark and historical baseline do not establish matched Mission strategy improvement. |
| General learning or transfer | **NOT PROVEN** | Existing historical evidence is advisory and scope-bound; no held-out transfer result exists. |

Existing targeted tests reviewed include:

- `mission-strategy-engine.test.ts:138-295` — deterministic runtime/validator candidates, plan changes, and missing-evidence blocking.
- `mission-auto-replan.test.ts:30-158` — replan materialization/history, concurrent requests, and bound World State facts.
- `mission-auto-replan-evidence.integration.test.ts:458-728` — current acceptance selection, durable selected strategy materialization, root-only dispatch, replay idempotency after state advance, and rejection of unrelated observations.
- `recipe-operation-runner.test.ts:2065` — local runtime Gate C, replay identity, concurrency, recovery, and transition proof integration.

The last focused run recorded on 2026-11-03 passed the strategy subset (22 tests) and one selected local runtime integration; 36 other tests in that test file were intentionally excluded by the test-name filter. This is focused evidence, not a full Mission lifecycle or benchmark.

## 7. Failure-mode and missing-invariant matrix

| Failure/risk | Current handling | Remaining gap |
|---|---|---|
| Diagnosis absent, malformed, or unsupported | Fail closed or terminalize the Mission as blocked | Failure taxonomy and strategy coverage are limited; unsupported cases are not evaluated as structured `NO_DECISION`. |
| Stale/unrelated runtime observations | Replan source binding rejects mismatched project/revision/environment/attempt/scope/provenance | Need general Decision Context contract and systematic stale-context tests for each strategy family. |
| Approval-required diagnosis | Automatic replan refuses it; plan steps retain explicit approval state | Keep this invariant in all future strategy and shadow paths. |
| Duplicate replan/materialization | Mission row lock, stable revision, matching Goal reuse, and run-level idempotency are present | A process-crash test across each materialize/dispatch/status boundary is still needed. |
| World State changes after selection | Runtime revalidates bound execution proof and current revision at effect time | A durable decision-to-dispatch check for current environment/World State is not represented as a separate decision record. |
| Candidate score exceeds a hard constraint | Current policies block supported invalid diagnoses/scopes before selection | A reusable generic hard-constraint contract and invalid-score override suite do not exist. |
| Strategy appears better but causes adverse effects | Existing acceptance/effect gates remain authoritative | No post-outcome strategy evaluator or risk-prediction calibration exists. |
| Candidate strategies are nominally different but semantically equivalent | Stable IDs and plan-delta assertions | No general equivalence detector; current tests prove concrete local plan differences only. |
| No safe strategy is justified | `blocked`/`not_applicable` paths exist | No first-class `NO_DECISION` with persisted reasons, confidence, and eligible alternatives. |
| Benchmark has missing or mismatched cases | Existing benchmark governance fails closed for incompatible baselines | Existing Code Agent benchmark is not a paired Decision Intelligence/Mission strategy benchmark. |

## 8. Baseline findings and G1 boundary

`docs/actual-capability-baseline-v1.md` is a dated capability snapshot, not a current Mission outcome baseline. The Code Agent benchmark and release baseline are separate governance objects (`docs/baseline-governance.md`, `lib/ai-orchestrator/src/benchmark/code-agent-benchmark.ts`); they must not be relabeled as Mission strategy outcomes.

The Mission/Goal/Execution/Acceptance/Episode/Observation/World Transition records expose several outcome counts and timestamps. Historical strategy repetition, strategy-effectiveness, prediction calibration, and strategy-linked resource cost cannot be computed until the population and joining rules are defined and enough Mission decision traces exist. Metrics lacking a traceable denominator must be reported `NOT MEASURABLE YET`, not filled with fixture-derived or inferred numbers.

G1 must therefore:

1. Pin the source revision, query/window, categories, eligible population, exclusion rules, and denominators.
2. Separate historical observed outcomes from deterministic fixture outcomes.
3. Report each of the 18 requested measures by task category, with `NOT MEASURABLE YET` where provenance or sample size is insufficient.
4. Avoid changing data or using Production. Any Development read must be explicitly read-only and the database target must be verified first.
5. Preserve benchmark case identity and distinguish deterministic regression fixtures from genuine historical performance.

No G1 performance values are asserted in this G0 report.

## 9. Minimum-change implementation plan

1. **G1 — Baseline:** establish reproducible Mission-specific metrics and a small scenario suite; mark unsupported historical metrics unavailable.
2. **G2 — Contracts:** define only the shared Decision Context, Strategy, Evaluation, Decision Trace, and Outcome Evaluation contracts needed to bridge existing Mission and acceptance records.
3. **G3 — Alternatives:** expand only from evidence-supported failure families; prove semantic plan differences and explicit blocked/NO_DECISION outcomes.
4. **G4 — Evaluation:** use deterministic hard constraints first; expose score components and stable rationale; do not claim calibrated prediction without outcome evidence.
5. **G5 — Durable trace:** extend the current plan snapshot and identity binding only if G2 proves it insufficient; bind to Mission, Goal, attempt, execution, plan, source evidence, and relevant World State/environment revision.
6. **G6 — Outcomes:** join trace to existing acceptance, direct observation, effect, and World Delta; classify inconclusive/missing evidence as inconclusive.
7. **G7 — Shadow mode:** record comparisons without changing dispatch, approval, or execution state.
8. **G8 — Controlled execution:** only narrowly scoped, explicitly gated strategies after shadow safety criteria pass; retain all existing authorizations and proof requirements.
9. **G9 — Verified improvement:** paired/matched benchmark against the G1 baseline, with sample counts, uncertainty, exclusions, regressions, and no quality claim from incomplete runs.
10. **G10 — Learning readiness:** decide from held-out evidence whether any historical transfer is justified; do not enable unrestricted learning by phase completion alone.

## 10. G0 decision

**G0: COMPLETE as an audit deliverable.**  
**G1: NOT STARTED / NOT PROVEN.**  
**Production-code changes during G0: none.**

The next gate is G1. No strategy subsystem redesign or rollout should begin before its denominators, data provenance, and reproducible baseline procedure are established.
