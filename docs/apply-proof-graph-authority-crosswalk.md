# Apply Changes — Proof Graph Authority & Evidence Crosswalk

**Status:** Apply Proof v2 authorization/precondition evidence is implemented on main; the Apply-specific read-only Proof Graph Projector remains pending
**Scope:** Mission-linked `APPLY_CHANGES` only  
**Source baseline:** `main` at `5103e66368e181c3fa00d11d00ea25e51677e070` (2026-11-17); PR #37 and PR #40 are merged
**Purpose:** determine whether the current durable Apply records can be projected into the Proof Graph Kernel v0 without inventing evidence or changing execution authority.

## 1. Architectural decision

The Proof Graph is a **read-only derived representation** of already durable execution evidence. It is not an acceptance writer, a mutation gate, a World State store, or a substitute for the existing Mission D2 gate.

The existing authorities remain separate:

1. **Canonical Proof** — `artifacts/api-server/src/lib/proof-foundation.ts::loadCanonicalProof` reloads the exact execution, current attempt, acceptance, and evidence snapshot. For proof-required Apply it supports both `apply_changes_v1` and `apply_changes_v2`; V2 reloads and re-derives the typed authorization/precondition evidence, while V1 remains backward-compatible.
2. **Mission D2** — `artifacts/api-server/src/lib/agent-state/apply-changes-mission-gate.ts::evaluateApplyChangesD2` independently binds the Apply Goal, active Mission plan, proposal, attempt, EffectBundle, direct observations, and a fresh materialized World Transition before releasing the successor.
3. **World State / World Transition** — `world-state.ts::materializeWorldStateForProject` materializes facts under the existing parent-revision compare-and-set; `ai_world_transitions` remains the durable transition record.
4. **Proof Graph Kernel v0** — `lib/ai-orchestrator/src/agent-state/proof-graph.ts::validateProofGraph` validates graph structure only. Its result explicitly declares `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY`.

A future projector may report how these authorities' evidence relates. It must not upgrade any of them, reinterpret an incomplete acceptance as accepted, create a transition, replay Apply, release a Mission successor, or persist a second proof ledger.

## 2. Required graph contract

The current Kernel contract requires one root Execution and exactly one satisfied control for each of these rules:

| Phase | Required control | Required evidence kind | Revision domain | Required provenance |
|---|---|---|---|---|
| Pre | `AUTHORIZATION_VALID` | `AUTHORIZATION` | `PLAN` | `SERVER_DERIVED` |
| Pre | `SCOPE_MATCHED` | `SCOPE` | `PLAN` | `SERVER_DERIVED` |
| Pre | `PRECONDITIONS_SATISFIED` | `PRECONDITION` | `WORLD` | Any declared Kernel provenance; evidence must still be fresh |
| Pre | `PARENT_REVISION_MATCHED` | `PARENT_WORLD_SNAPSHOT` | `WORLD` | `SERVER_DERIVED` |
| Pre | `WORKSPACE_BASE_REVISION_MATCHED` | `PARENT_WORKSPACE_SNAPSHOT` | `WORKSPACE_TREE` | `SERVER_DERIVED` |
| Post | `EFFECT_PROVEN` | `EFFECT_OBSERVATION` | `WORKSPACE_TREE` | `DIRECT_OBSERVATION` |
| Post | `ACCEPTANCE_SUCCEEDED` | `EXECUTION_ACCEPTANCE` | `PLAN` | `SERVER_DERIVED` |
| Post | `WORLD_TRANSITION_MATERIALIZED` | `WORLD_TRANSITION` | `WORLD` | `SERVER_DERIVED` |

The Kernel also requires:
- every control to reference exactly the DATA nodes connected to it;
- all control evidence to be fresh and to carry the exact revision required by the rule;
- every post-execution control to be linked to data bound to the root execution;
- an execution-produced output to be a fresh direct observation of the resulting workspace tree;
- the top-level parent/result World and Workspace revisions to be distinct digests;
- exact root Execution context binding for project, Episode, attempt, Mission, and Goal.

These requirements are stricter than “an Execution has an Acceptance and a Transition.” A graph assembled from status labels alone cannot satisfy the contract honestly.

## 3. Apply evidence crosswalk

Status meanings:
- **CONFIRMED:** a durable, server-owned source and a current production verifier bind the evidence needed for this control.
- **PARTIAL:** relevant server-owned data exists, but the complete control decision is not durably represented or independently reconstructable yet.
- **BLOCKED:** a truthful v0 projection must not emit this control as `SATISFIED` on the current source contract.

| Kernel control | Existing source of truth | Binding currently verified in code | Readiness |
|---|---|---|---|
| `AUTHORIZATION_VALID` | applyChangesHandler authenticates the request, owner-scopes the project, requires the proposal to remain eligible, and authorizes an exact subset. New V2 ACTION_REQUESTED payloads carry a bounded ApplyAuthorizationDecision with explicit ALLOW, actor/project/owner, proposal revision, execution/attempt, capability, approved-path digest, proposal-change digest, and change-set digest. | deriveApplyChangesProofV2Evidence reloads project and proposal state, matches actor to ai_executions.userId and projects.ownerId, checks proposal/execution/attempt/capability/digest bindings, then verifies the referenced authorization Journal row and content hash. The decision body is self-hashed; the event payload hash binds the persisted payload. | CONFIRMED for apply_changes_v2; V1 remains historical and has no retroactive V2 receipt |
| `SCOPE_MATCHED` | Mission Goal `successCriteria` and `outcomeContract`, Mission `autonomyPolicy.applyMission`, the active plan revision, proposal identity, Execution, and the Apply Mission link. | `applyChangesMissionRequirement` and `loadApplyMissionLink` compare the plan snapshots, requirements, active plan, proposal, candidate identity, and exact Goal/Mission/Project link. The Execution node's scope hash can be server-derived from that exact immutable scope. | **CONFIRMED for the Mission-linked Apply path** |
| `PRECONDITIONS_SATISFIED` | New V2 requests persist a typed, bounded ApplyPreconditionReceipt with deterministic outcomes and Journal references for owner/proposal eligibility, exact subset, candidate validation, candidate stability/live-root base, execution lease, and (when Mission-linked) the immutable parent snapshot. | The V2 derivation reloads each referenced Journal row, checks its expected stage and content hash, verifies receipt/action/execution/attempt bindings, and independently checks validation receipts, tree digests, worker/lease timing, and Mission parent intent. Missing, stale, mismatched, or unreferenced evidence fails closed. | CONFIRMED for apply_changes_v2; V1 remains historical and lacks the normalized receipt |
| `PARENT_REVISION_MATCHED` | The server-built ApplyWorldTransitionIntent stored on ACTION_REQUESTED; ai_world_transitions.parentWorldRevision and parentFactRefs; the existing World State materializer. | The intent is captured before Apply side effects; live transition creation and accepted-missing-row recovery reuse the immutable parent and compare it with current authoritative facts. Materialization still uses the existing expected-revision CAS. | CONFIRMED for Mission-linked Apply with the persisted intent; drift fails closed |
| `WORKSPACE_BASE_REVISION_MATCHED` | Proposal `baseTreeHash`; the Apply proof's exact before-observation ID; direct `workspace.tree_hash` observation. | `deriveApplyChangesProof` checks the before observation is bound to this Execution/Episode/source and equals the proposal base tree hash, with direct provenance and complete/fresh state. | **CONFIRMED for the proof-required Apply artifact** |
| `EFFECT_PROVEN` | ai_agent_effects, ai_agent_effect_bundles, Action events, and exact direct before/after observations. | The server derives the Action and Effect Contract, checks event and contract hashes, exact bundle/effect identity, and direct complete/fresh observations matching base/promoted tree hashes. D2 independently rechecks the Mission-scoped observations. | CONFIRMED for proof-required Apply V1 and V2 |
| `ACCEPTANCE_SUCCEEDED` | ai_execution_acceptances and ai_execution_evidence_snapshots for the exact project/execution/attempt. | loadCanonicalProof reloads the current attempt and freshly derives the relevant Apply artifact; V2 additionally reconstructs and hash-compares authorization and precondition evidence. The Acceptance row or a serialized PROVEN label alone is insufficient. | CONFIRMED for proof-required Apply V1 and V2 |
| `WORLD_TRANSITION_MATERIALIZED` | The exact `ai_world_transitions` row, linked EffectBundle and observations, the Apply binding in `evidenceRefs`, and the active Mission plan. | `evaluateApplyChangesD2` is the live-root lifecycle gate. `isBoundApplyTransition` / `projectApplyMissionLink` are read projections; they do not replace D2. The read projection only reports D2 proven when the exact transition is materialized/fresh and bound to Acceptance, Goal, plan, and direct before/after observations. | **CONFIRMED for D2; read projection is not an authority** |

## 4. Revision and identity binding

The projector must derive all revisions from the same server-loaded records used by the existing authorities:

- **Plan revision:** the active Mission plan hash, matched across the Apply Goal's `successCriteria`, `outcomeContract`, and `autonomyPolicy.applyMission`.
- **Parent World revision:** the exact `worldTransitionIntent.parentWorldRevision`; never a later `getProjectWorldState()` result.
- **Resulting World revision:** the materialized transition's `resultingWorldRevision`.
- **Parent Workspace revision:** the Apply proposal's `baseTreeHash`, corroborated by the direct before observation.
- **Resulting Workspace revision:** the proposal's promoted/candidate tree hash, corroborated by the direct after observation and Apply proof.

The root Execution node must use the Action ID and capability ID reconstructed from the server-owned Apply Action, not client input or a model-generated graph. The `scopeHash` must be computed by a canonical server-side function over the exact project/Mission/Goal/Execution/operation/proposal/candidate/plan binding. It must not be copied from a display projection or accepted from a request body.

Each DATA node's `evidenceRef` must resolve to an existing durable record/event/observation and its `contentHash` must be recomputed from the canonical server-loaded content. An ID string is a locator, not a content hash. Freshness and provenance must be read from the source record; they must never default to `fresh` or `DIRECT_OBSERVATION`.

## 5. What was gated and what changed on main

The original source gap consisted of two missing durable records: a per-attempt authorization decision and normalized precondition outcomes. Those two gaps are now closed for new apply_changes_v2 executions by merged PR #37, with the attempt/subset identity refinement in merged PR #40.

The V2 evidence is not a copied status label:
- The authorization decision is typed, bounded, self-hashed, and bound to the server-owned actor, project owner, proposal revision, Execution, attempt, capability, paths, proposal content, and change-set digest.
- The precondition receipt is typed and references Journal records for the exact checks. The derivation reloads those records, checks stage and payload hashes, and independently verifies proposal, validation, candidate, lease, and parent-snapshot bindings.
- The V2 proof artifact carries the authorization decision hash, precondition receipt hash, and unique Journal IDs.
- Historical V1 records remain readable; they are not retroactively upgraded to V2 evidence.

**The remaining blocker is projection, not evidence persistence.** The current Execution Proof Graph Projector supports the Mission-free runtime_start_gate_c_v1 profile only. apply_changes_v2 is a Canonical Apply proof artifact; it is not yet transformed into an Apply-specific ProofGraph by a server-side read-only projector.

Therefore:
1. Do not keep AUTHORIZATION_VALID or PRECONDITIONS_SATISFIED marked blocked for new V2 records.
2. Do not claim that Apply Proof Graph is implemented merely because V2 Canonical Proof is implemented.
3. Do not use Kernel structural PASS to upgrade Canonical Proof, Acceptance, D2, World Transition, or Mission release.
4. Implement the Apply projector as a separate read-only adapter after the source contract and adversarial tests are finalized.
## 6. Projector implementation contract

Once the two blocked controls have durable evidence, implement a bounded server-only projector with these constraints:

1. Load one exact Mission-linked Apply Execution and its linked Action/Episode, current Acceptance/evidence snapshot, Effect/EffectBundle, direct before/after observations, proposal, parent intent, and materialized World Transition from a consistent database view.
2. Re-run the existing authority checks in their existing order: exact scope binding, `loadCanonicalProof`, and the D2 verifier/read-only equivalent. Never trust Dashboard fields, a cached summary, or an incoming graph.
3. Return a discriminated result: `NOT_PROJECTABLE` with missing/invalid evidence references, or `PROJECTED` with the typed graph and the Kernel's structural result. Do not fill missing evidence with synthetic sentinel nodes.
4. Call `validateProofGraph` only after every required source is present and bound. A structural `PASS` remains diagnostic and must not be surfaced as Canonical Proof, D2, Mission completion, or general “PROVEN”.
5. Make projection deterministic under row/edge order changes. Do not write graph rows, change Acceptance, materialize World State, create Transitions, dispatch Tasks, or mutate files.
6. Keep the first consumer limited to a single Apply execution detail/read path. Do not run locking Canonical Proof reads for every Mission card or broad dashboard polling.
7. Add PostgreSQL-backed tests using the existing Apply fixtures, not only synthetic graph fixtures.

## 7. Required tests before enabling a consumer

- Complete accepted Apply with materialized D2 transition yields one deterministic graph and Kernel structural `PASS`.
- Missing, duplicate, stale, wrong-attempt, wrong-project, wrong-plan, or mismatched authorization evidence yields `NOT_PROJECTABLE` (or a structural `FAIL` only when a fully sourced graph is intentionally built for diagnostics).
- Missing/duplicate/mismatched precondition result or parent fact reference cannot be defaulted to satisfied.
- Parent World revision drift prevents projection; a later World Revision cannot be relabeled as the recorded parent.
- Before/after observations must be distinct, direct, complete, fresh, execution/episode-bound, and match base/promoted tree hashes.
- An observed EffectBundle without accepted Canonical Proof is not enough.
- A successful Acceptance without a materialized D2 transition is not enough.
- A materialized Transition from another execution, attempt, proposal, Goal, or plan is not enough.
- Repeated reads and row-order permutations produce the same graph hash and violation ordering.
- A projection performs no writes and does not change successor eligibility.

## 8. Explicit non-goals

This Apply-specific slice must not merge with the existing Runtime Start projector, generalize automatically to GitHub delivery, arbitrary Tasks, Recipes, or Workflows, implement ETV, replace Canonical Proof, merge EvidenceGraph with Knowledge Graph, or create a universal World State proof. Each operation family requires its own source crosswalk and evidence contract.

**Exit criterion:** the two blocked controls have durable, independently reloadable evidence; a server-only Apply projector passes PostgreSQL-backed positive and adversarial tests; and the result is consumed only as a read-only structural diagnostic.

## 9. Current source status and closure boundary — 2026-11-17

- Main baseline: 5103e66368e181c3fa00d11d00ea25e51677e070.
- Merged implementation: PR #37 (Apply Proof v2 authorization/precondition evidence) and PR #40 (attempt identity and exact submitted-subset/Hunk digest binding).
- Compatibility: V1 reconstruction remains supported; legacy records must not be relabeled as V2.
- Existing verification: GitHub Actions run #856 passed all-package typecheck, the test step, Proof Graph Kernel v0 validation, and the independent-PostgreSQL-session Apply recovery proof. Its Release validation job was skipped; this is not a Release Validation pass.
- Not implemented: an Apply-specific server-only Proof Graph Projector and its authenticated consumer.
- Required next evidence: PostgreSQL-backed projector tests for exact V2 source reconstruction, missing/mismatched Journal rows, identity/attempt/proposal/plan drift, stale validation, parent drift, transition absence, deterministic hashing, and zero writes. The projector must return NOT_PROJECTABLE whenever any required source cannot be reloaded and verified.

**Updated exit criterion:** Apply V2 evidence persistence and reconstruction are confirmed on main. This crosswalk is complete as a source contract for that evidence, but the Apply Proof Graph implementation remains open until its read-only projector and scoped consumer are built and adversarially verified.