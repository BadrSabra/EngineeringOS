# Objective / Claim Completion Gate + Production Reachability — Implementation Plan

> Status: **P2 implemented.** AI-OBJ-004/007/008/009/010/012 are implemented, AI-OBJ-011 telemetry now reaches RunLedger/SSE/Dashboard, and AI-OBJ-013/014 are covered by the orchestrator regression suite. Live provider baseline approval remains a separate rollout gate.
> Scope: prevent the EngineeringOS agent from ending a Production Reachability task with a behaviorally correct answer that does not answer the primary objective, and force the path `User Claim → Required Evidence → Caller → Target Symbol → Consumer → Final Answer`.
> Tracking IDs: `AI-OBJ-001 … AI-OBJ-015` retained verbatim from the source plan.
> Decision: the objective verdict **extends the existing `RunLedger` / claim machinery** (`extend_existing`) rather than introducing a parallel verdict system.

---

## 0. Grounding — what already exists (build on, do not rebuild)

The current forensic/evidence architecture already provides most of the *building blocks* this plan needs. The work is additive: an explicit objective contract, a completion gate, reachability-edge modeling, and strict completion semantics. The plan below is written against the real code, not a blank slate.

| Concept | Existing implementation (verified) |
|---|---|
| Claim + evidence binding | `lib/ai-orchestrator/src/evidence-integrity.ts` — `EvidenceRecord`, `ClaimRecord`, `bindClaimToEvidence`, `validateClaim` (DIRECT-only), `buildClaimOrientedEvidenceMap` |
| Claim lifecycle / ledger | `evidence-integrity.ts` — `buildRunLedger` (853), `buildRuntimeLedger` (1018), `validateTelemetry` (906), `RunLedger` (242) |
| Scope derivation | `evidence-integrity.ts` — `deriveVerdictScope` (276), `deriveScopedFindingStatus` (293), `deriveScopedFindingStatusFromPaths` (337), `classifySourceScope` (568+); `forensic-source-policy.ts` — `normalizeForensicSourcePath`, `isPathWithinForensicScope` |
| Required-claims closure (FEG-011/012) | `lib/ai-orchestrator/src/required-claims.ts` — `evaluateBehaviorRequiredClaims`, `RequiredClaim`, `RequiredClaimClosure` (claims derived from the **question**) |
| Production reachability trace | `lib/ai-orchestrator/src/semantic-trace.ts` — `ProductionReachabilityTraceSchema` (50), `CrossFileSemanticTraceSchema` (41) |
| `done` blocking / terminal kinds | `chat-agent.ts` — `relayForensicTerminal` (975), `classifyForensicTerminal` (4-way), `verificationRejectionReasons` (5448) |
| Evidence-relevance validation | `evidence-integrity.ts` — `validateClaim` rejects weak/cached/test/scope-mismatch records |
| Budget / discovery caps | `tool-execution-engine.ts` — `splitRunBudget`, `STRUCTURED_OUTPUT_MAX_TOOL_CALLS=36`, `MAX_FORENSIC_DISCOVERY_FILES`; `speculative-prefetch.ts` |
| Execution-handoff scope restore | `chat-agent.ts` — restored scope from `priorRepairPlanMetadata` (2100) |
| Worked example target | `lib/knowledge-engine/src/inference.ts` — `computeCentrality` (24), called by `index.ts` (142) |

### Key gaps this plan closes
1. **Objective completion** is enforced before a final answer (AI-OBJ-005).
2. **Objective contracts and claim decomposition** preserve the primary objective before search (AI-OBJ-001/002).
3. **Reachability edges** structurally reject import-only proof (AI-OBJ-004).
4. **Terminal and answer semantics** distinguish blocked, partial, insufficient-evidence, mismatch, and recovery-scope failures (AI-OBJ-010/012).
5. **Objective scope enforcement** emits `JUSTIFIED_SCOPE_EXPANSION` / `UNJUSTIFIED_SCOPE_EXPANSION` and blocks unrelated reads (AI-OBJ-008).
6. **Targeted recovery** stays bounded to the missing edge/symbol rather than rescanning the project (AI-OBJ-009).

---

## 1. Decision: verdict source

```text
ObjectiveCompletionGate verdict = derived FROM the existing RunLedger built by
buildRuntimeLedger/buildRunLedger, extended with objectiveDeclared + reachabilityEdges.
No second, independent verdict pipeline.
```
Rationale: the claim machinery already owns scope, DIRECT-only proof, telemetry reconciliation (fail-closed `validateTelemetry`), and execution-handoff scope restore. Forking a parallel "objective verdict" would duplicate those invariants and let the two disagree. Extending the ledger keeps a single source of truth (`runtimeLedger.scopedFindingStatus` / `verdictScope` already feed the `decision_trace`).

---

## 2. Execution phases

### P0 — Core (without these, there is no objective)

**AI-OBJ-001 — Task contract carries the primary objective explicitly.**
- Add optional `objective` to the task contract / `ChatOutputSchema` and `RepairPlanMetadataSchema` (`lib/ai-orchestrator/src/schemas/chat.schema.ts`) with:
  - `objectiveType` (e.g. `PRODUCTION_REACHABILITY`)
  - `requiredClaims: string[]` (e.g. `caller_reaches_target`, `target_executes`, `output_consumed`)
  - `requiredEvidenceEdges: Array<{ from, to, relation }>` (e.g. `ENTRY→CALLER`, `CALLER→TARGET`, `TARGET→CONSUMER`)
  - `completionCriteria: string[]`
- Acceptance: a task must not be representable only as `FULL_FORENSIC_AUDIT` and lose its original objective. If an objective is declared it is persisted (mirrors #46 scope persistence) so execution handoff restores it.

**AI-OBJ-002 — Claim Decomposition before search.**
- Extend `lib/ai-orchestrator/src/required-claims.ts` so a declared objective is decomposed into `RequiredClaim[]` **before** the first source expansion (today claims are only derived at evaluation).
- Worked example (objective `computeCentrality` reachability):
  - C1 `caller_reaches_target`: does a production caller reach `computeCentrality`?
  - C2 `target_executes`: does the caller actually invoke `computeCentrality`?
  - C3 `output_consumed`: does its output reach a consumer?
  - C4 `path_complete_and_proven`: is the full chain proven?
- Acceptance: every Production Reachability task holds a concrete claim list before the first read.

**AI-OBJ-003 — Claim-driven investigation planner (symbol-centric).**
- Enforce that the first tool(s) are target-symbol / direct-reference directed, not a broad scan. Applied in `tool-execution-engine.ts` (main loop + `splitRunBudget`) and the forensic discovery gate.
- Forbidden start: `POST /api`, directory listing, package discovery, generic repo search — unless justified.
- Acceptance: the first tool used resolves to the target symbol or a direct reference.

**AI-OBJ-005 ⭐ — Objective Completion Gate (highest priority).**
- New validator `objectiveCompletionGate(runtimeLedger, objective, reachabilityEdges)` run **before** a final answer is emitted.
- Problems `PROVEN | PARTIALLY_PROVEN | NOT_PROVEN | BLOCKED`: every required claim has evidence, every required edge is proven, and the final answer reflects the evidence. Example `C1=PROVEN, C2=PROVEN, C3=NOT_PROVEN, C4=NOT_PROVEN ⇒ BLOCKED`.
- Wired into `chat-agent.ts` `verificationRejectionReasons` + `relayForensicTerminal` so `BLOCKED` cannot emit `response completed` as final.
- Acceptance: `done` is refused while any required claim/edge is missing.

---

### P1 — Proof & governance

**AI-OBJ-004 — Production Reachability Proof Object.**
- Add explicit `ReachabilityEdge { fromFile, fromSymbol, toFile, toSymbol, sourceSpan, relationship, proven }` in `semantic-trace.ts`.
- Rule encoded in code: **an import alone does not create a proven edge** (must be direct invocation / data flow with a source span). Structural rejection, not a prompt hint.
- Worked example: `getGraphCentrality()@graph.ts →(direct invocation) computeCentrality()@inference.ts`, proven.

**AI-OBJ-007 — Evidence Relevance Gate.**
- For each `Evidence → Claim`: reject evidence that does not prove the claim it is attached to (above the existing `validateClaim` DIRECT/scope checks).
- Example: `totalDegree: inD + outD` proves `C_BEHAVIOR`, **not** `C_PRODUCTION_REACHABILITY`, and must not enter the production-claim proof set.
- Acceptance: a behavior excerpt cannot satisfy a reachability claim.

**AI-OBJ-008 — Scope Enforcement.**
- Associate a scope policy with each claim. Primary scope: the target file (`lib/knowledge-engine/src/inference.ts`); allowed expansion: caller/reference, production route/service, consumer; forbidden: benchmark, tests, unrelated providers/agents, package metadata unless symbol resolution demands it.
- Emit `JUSTIFIED_SCOPE_EXPANSION` / `UNJUSTIFIED_SCOPE_EXPANSION` telemetry and block unrelated reads.

**AI-OBJ-009 — Targeted Recovery.**
- When an edge (e.g. `TARGET → CONSUMER`) is unproven, do **not** rescan the whole project. Recovery must produce a bounded "missing edge / required symbol / targeted search / targeted read / re-evaluate only the missing claim" envelope (reuse `forensic-recovery.ts` envelope).
- If recovery exceeds this scope: `RECOVERY_SCOPE_FAILURE`.

**AI-OBJ-010 — Final Answer Validator.**
- Before sending the answer, verify the 6 rules: (1) core question answered, (2) every core claim has evidence, (3) no behavioral substitute for the primary objective, (4) `NOT_PROVEN` reserved for genuinely unproven edges, (5) no fabricated Findings, (6) production is **not** proven by import or package membership.

**AI-OBJ-012 — Validator Failure Semantics.**
- Distinguish `ANSWER_COMPLETE | ANSWER_PARTIAL | OBJECTIVE_BLOCKED | EVIDENCE_INSUFFICIENT | RECOVERY_REQUIRED`. Do **not** use `NOT_PROVEN` as the blanket catch-all for every failure.

---

### P2 — Telemetry & verification

**AI-OBJ-011 — Telemetry.**
- Extend `RunLedger` / `validateTelemetry` (fail-closed) with: `objectiveType`, `requiredClaims`, `completedClaims`, `missingClaims`, `requiredEdges`, `provenEdges`, `failedEdges`, `scopeExpansions`, `unjustifiedReads`, `recoveryTriggered`, `recoveryTarget`, `completionGateResult`, `finalAnswerType`.
- Example: `objectiveType: PRODUCTION_REACHABILITY, claims: 4, provenClaims: 1, missingClaims: 3, completionGate: BLOCKED` instead of `response completed`.

**AI-OBJ-013 — Regression Tests** (unit, in `lib/ai-orchestrator/src/__tests__/`).
- T1 behavioral evidence present but production caller unproven → `BLOCKED`.
- T2 caller + target invocation proven, consumer unproven → `PARTIALLY_PROVEN`.
- T3 all edges proven → `PROVEN`.
- T4 import only → `NOT_PROVEN`.
- T5 recovery reads non-required files → `RECOVERY_SCOPE_FAILURE`.
- T6 model returns behavioral answer instead of production answer → `OBJECTIVE_MISMATCH`.

**AI-OBJ-014 — Runtime Benchmark.**
- Re-run the SAME prompt used in recent rounds: *prove or refute production reachability of knowledge-engine*. Success requires a complete proof chain (one of `PROVEN | PARTIALLY_PROVEN | NOT_PROVEN`), never merely an explanation of `computeCentrality`.

**AI-OBJ-015 — Final success criteria.**
- The test **fails** on any of: behavioral answer instead of production answer; unjustified broad scan; evidence not bound to its claim; import = reachability; AI-chat path conflated with knowledge-engine path; completion despite missing claims; recovery broad scan; `NOT_PROVEN` as a fake investigation failure.
- It **passes** only when it produces: `TASK → CLAIMS → TARGET SYMBOL → CALLER → PRODUCTION EDGE → OUTPUT CONSUMER → EVIDENCE → OBJECTIVE COMPLETION → FINAL ANSWER`.

---

## 3. Priority table

| Priority | ID | Goal |
|---|---|---|
| **P0** | AI-OBJ-005 | Objective Completion Gate |
| **P0** | AI-OBJ-002 | Claim Decomposition |
| **P0** | AI-OBJ-003 | Claim-Driven Planner |
| P1 | AI-OBJ-004 | Reachability Edge Model |
| P1 | AI-OBJ-007 | Evidence Relevance Gate |
| P1 | AI-OBJ-009 | Targeted Recovery |
| P1 | AI-OBJ-008 | Scope Enforcement |
| P1 | AI-OBJ-010 | Final Answer Validator |
| P1 | AI-OBJ-012 | Failure Semantics |
| P2 | AI-OBJ-011 | Telemetry |
| P2 | AI-OBJ-013 | Regression Tests |
| P2 | AI-OBJ-014 | Runtime Benchmark |

---

## 4. Proposed execution order (dependency-safe)

1. **AI-OBJ-001** (contract → required before the gate can see an objective)
2. **AI-OBJ-002** (claim decomposition → feeds the gate)
3. **AI-OBJ-005** (completion gate → consumes 001+002)
4. **AI-OBJ-004** + **AI-OBJ-007** (evidence/edge model → gate needs proven edges, gate also validates them)
5. **AI-OBJ-012** + **AI-OBJ-010** (failure semantics + final answer validator — tighten gate output)
6. **AI-OBJ-008** + **AI-OBJ-009** (scope + targeted recovery)
7. **AI-OBJ-003** (claim-driven planner first-tool rule — independent, self-contained)
8. **AI-OBJ-011** (telemetry after the models above stabilize)
9. **AI-OBJ-013** (regression tests), then **AI-OBJ-014** (runtime benchmark on `computeCentrality`)

Dependency note: `AI-OBJ-005` depends on `001`+`002`; `001` and `002` are independent and can proceed in parallel. `AI-OBJ-003` is independent of the gate chain.

---

## 5. Hard-and-fast rules (enforced in code, not prompt-only)

- `done` is refused while any required claim or edge is unproven.
- A behavioral excerpt cannot satisfy a reachability claim.
- Import / package membership cannot prove production reachability.
- Recovery is bounded to the missing edge/symbol; exceeding it is `RECOVERY_SCOPE_FAILURE`.
- `NOT_PROVEN` is never the blanket label for an investigation failure.
- The gate verdict is derived from the existing `RunLedger` (single source of truth); no parallel verdict pipeline.
