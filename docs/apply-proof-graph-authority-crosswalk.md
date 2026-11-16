# Apply Changes — Proof Graph Authority & Evidence Crosswalk

**Status:** forensic design baseline; V2 authorization/precondition evidence is implemented on PR #36; projector remains intentionally gated  
**Projection scope:** Mission-linked `APPLY_CHANGES` only  
**V2 evidence scope:** new route-only and Mission-linked Apply executions; legacy V1 records remain readable  
**Source baseline:** `main` at `ccd8d11f0b66098194e99bd55619d467cb1f7c3a` (2026-11-16); implementation delta: PR #36  
**Purpose:** determine whether the current durable Apply records can be projected into the Proof Graph Kernel v0 without inventing evidence or changing execution authority.

## 1. Architectural decision

The Proof Graph is a **read-only derived representation** of already durable execution evidence. It is not an acceptance writer, a mutation gate, a World State store, or a substitute for the existing Mission D2 gate.

The existing authorities remain separate:

1. **Canonical Proof** — `artifacts/api-server/src/lib/proof-foundation.ts::loadCanonicalProof` reloads the exact execution, current attempt, acceptance, and evidence snapshot. It reconstructs the stored Apply proof mode (`apply_changes_v1` for historical executions or `apply_changes_v2` for new executions) and compares the stored artifact with a fresh server-derived artifact.
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
| `AUTHORIZATION_VALID` | The Apply route authenticates the user/project, verifies proposal eligibility and exact authorized subset, then persists `authorizationDecision` in the hashed `ACTION_REQUESTED` payload and `APPLY_AUTHORIZATION_DECISION` Journal row. The bounded decision binds actor/project owner, proposal revision, Execution/attempt, capability, approved-path hash, proposal-content hash, change-set hash, and `ALLOW`. | `deriveApplyChangesProof` reloads the exact Project, Proposal, Execution, Action event, and referenced Journal row; it verifies the canonical decision hash and compares actor/owner/project/proposal/revision/attempt/capability/path/content/change-set bindings against current durable rows. It does not treat Action's descriptive `authorization` object or `ai_delivery_policies.approvedBy` as a per-Apply decision. | **CONFIRMED for V2; legacy V1 has no decision receipt** |
| `SCOPE_MATCHED` | Mission Goal `successCriteria` and `outcomeContract`, Mission `autonomyPolicy.applyMission`, the active plan revision, proposal identity, Execution, and the Apply Mission link. | `applyChangesMissionRequirement` and `loadApplyMissionLink` compare the plan snapshots, requirements, active plan, proposal, candidate identity, and exact Goal/Mission/Project link. The Execution node's scope hash can be server-derived from that exact immutable scope. | **CONFIRMED for the Mission-linked Apply path** |
| `PRECONDITIONS_SATISFIED` | V2 `ACTION_REQUESTED` stores a bounded, hashed `preconditionReceipt`. Its seven required checks cover owner match, proposal eligibility, exact approved subset, passed candidate validation, candidate stability, live-root/base match, and execution lease ownership. Mission-linked Apply adds the eighth `MISSION_PARENT_SNAPSHOT_BOUND` check. Every check references a stage-specific `ai_apply_journal` row by ID and canonical content hash. | `deriveApplyChangesProof` reloads every referenced row and revalidates its stage/hash and semantic fields against current proposal, project, execution, validator receipt, lease, Action, and optional immutable Mission parent intent. The natural-language Action preconditions remain declarations; only these server-owned receipts are treated as outcomes. | **CONFIRMED for V2; legacy V1 has no structured receipt** |
| `PARENT_REVISION_MATCHED` | `ApplyWorldTransitionIntent` stored on `ACTION_REQUESTED`; `ai_world_transitions.parentWorldRevision` and `parentFactRefs`; the World State materializer. | `buildApplyChangesWorldTransitionIntent` canonicalizes the immutable parent revision/fact refs. Apply finalization reuses that parent and `materializeWorldStateForProject` enforces `expectedWorldRevision` rather than relabeling a later projection as the original parent. | **CONFIRMED** |
| `WORKSPACE_BASE_REVISION_MATCHED` | Proposal `baseTreeHash`; the Apply proof's exact before-observation ID; direct `workspace.tree_hash` observation. | `deriveApplyChangesProof` checks the before observation is bound to this Execution/Episode/source and equals the proposal base tree hash, with direct provenance and complete/fresh state. | **CONFIRMED for the proof-required Apply artifact** |
| `EFFECT_PROVEN` | `ai_agent_effects`, `ai_agent_effect_bundles`, `ACTION_REQUESTED` / `ACTION_COMMITTED`, and the exact after-observation. | `deriveApplyChangesProof` reconstructs the expected Action and Effect Contract, checks payload hashes, exact EffectBundle/Effect identity, and the direct complete/fresh after observation matching the promoted candidate tree. D2 separately rechecks its project-scoped observations. | **CONFIRMED for the current Apply proof mode** |
| `ACCEPTANCE_SUCCEEDED` | `ai_execution_acceptances` and `ai_execution_evidence_snapshots` for the exact project/execution/attempt. The server-derived snapshot stores exactly one Apply artifact, either V1 or V2 according to the immutable request. | `loadCanonicalProof` locks and reloads the current attempt, then freshly derives and hash-compares the stored artifact, including V2 authorization/precondition Journal bindings. The Acceptance row alone or a serialized `PROVEN` label is insufficient. | **CONFIRMED for V1/V2 proof-required Apply** |
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

## 5. Why the Projector is still gated

The original two evidence gaps are now closed for new V2 Apply executions on PR #36:

- **Authorization decision identity:** `authorizationDecision` is stored on the existing hashed `ACTION_REQUESTED` event and in `APPLY_AUTHORIZATION_DECISION`. Its canonical digest and durable identity bindings are reconstructed before Apply acceptance and again when Canonical Proof is loaded.
- **Precondition evaluation identity:** `preconditionReceipt` references the exact server-owned Apply Journal rows for the seven required checks and, for Mission-linked Apply, the immutable parent snapshot check. Each row's content hash and semantic bindings are revalidated. Validator evidence must be passed, bound to the exact operation/revision/base/candidate/change-set, and observed no later than the server-owned candidate-stability timestamp.

This is deliberately versioned. New Apply executions persist `apply_changes_v2`; historical `apply_changes_v1` requests and artifacts remain readable and retain their existing verifier. V1 records do not retroactively acquire V2 authorization or precondition receipts and must not be projected as if they had them.

**The Projector remains gated for a different reason:** no production server-side assembler yet loads the complete Mission-linked Apply source set, builds the typed DATA/CONTROL/EXECUTION graph, independently rechecks Canonical Proof plus D2, and runs the structural Kernel without writes. The V2 receipt is an input source for that future projector, not a projector and not a new authority. The existing synthetic Kernel fixture still proves only structural rules, not a production Apply projection.

Implementation must continue to reuse the existing `ACTION_REQUESTED` event, `ai_apply_journal`, Canonical Proof, and D2. Do not add a second proof store, change Acceptance/D2 authority, grant execution authority to the Kernel, or fill missing references with synthetic evidence.

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

This slice does not generalize Proof Graph to Runtime Start, GitHub delivery, arbitrary Tasks, Recipes, Workflows, or every mutation. It does not implement ETV, replace Canonical Proof, merge the EvidenceGraph with the Knowledge Graph, or create a universal “World State proof”. Those require separate crosswalks and evidence contracts.

**Exit criterion:** the V2 authorization/precondition receipts are independently reloadable; a server-only Mission-linked Apply projector passes PostgreSQL-backed positive and adversarial tests; and its result is consumed only as a read-only structural diagnostic.
