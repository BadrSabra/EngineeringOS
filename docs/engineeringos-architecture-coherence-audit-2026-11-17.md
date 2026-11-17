# EngineeringOS Architecture Coherence Audit — 2026-11-17

**Repository:** BadrSabra/EngineeringOS  
**Baseline:** main at 5103e66368e181c3fa00d11d00ea25e51677e070  
**Method:** source-first review of current main, targeted GitHub Actions/PR metadata, and the relevant contracts. This is a bounded architecture audit, not an exhaustive source-family census or a full production certification.

## 1. Executive decision

EngineeringOS has strong, server-owned execution and evidence controls on selected paths. The current architectural risk is not a lack of components; it is **incomplete coherence between revision domains, evidence contracts, read projections, and the decisions that consume them**.

The next valuable implementation slice is an Apply-specific, read-only Proof Graph Projector that consumes the now-persisted Apply Proof v2 evidence and independently reloads Canonical Proof and the Mission D2/World Transition boundaries. It must not replace or extend those authorities.

Do not generalize the graph, activate learning, or claim a product-wide verification score before the source census and the operation-specific proof contracts are closed.

## 2. Verified main state

| Area | Current main state | Boundary |
|---|---|---|
| Snapshot-Bound Apply Transition | PR #23 and independent-session validation PR #30 merged | The targeted recovery path is verified; P3.5/P6 are not globally closed |
| Apply Proof v2 | PR #37 merged; typed authorization decision and Journal-backed precondition receipt are persisted and re-derived | Evidence artifact only; does not add Acceptance, D2, or Mission authority |
| Apply attempt/subset binding | PR #40 merged; canonical operation ID, distinct attempt ID, and exact submitted Hunk digest are bound | Does not implement an Apply Graph Projector |
| Proof Graph Kernel v0 | PR #38 merged; deterministic structural checks strengthened | STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY remains mandatory |
| Execution Proof Graph | Server projector and authenticated consumer exist for runtime_start_gate_c_v1 | Other profiles, including Apply, remain unsupported |
| Decision Intelligence | G3/G4/G5/G6/G7/G8 remain partial to varying degrees; G9 not measurable; G10 not started | No demonstrated general strategy improvement or cross-project transfer |

### CI boundary

GitHub Actions run [#856](https://github.com/BadrSabra/EngineeringOS/actions/runs/43985363575) on the main head completed successfully for:
- codegen drift, all-package typecheck, and test job;
- Proof Graph Kernel v0 validation;
- independent-PostgreSQL-session Snapshot-Bound Apply recovery;
- deferred Task dispatch concurrency, Task acceptance after HTTP response loss, and PostgreSQL-backed Runtime process recovery;
- OpenAPI contract drift guard and contract-change policy check.

The separate **Release validation** job was **skipped**. This run is not a Release Validation pass, and its focused checks do not certify all runtime/provider/project journeys.

## 3. Keep the proof systems distinct

These systems answer different questions and must not be collapsed into one generic graph:

| System | Question answered | Authority |
|---|---|---|
| Knowledge Graph | What code entities and relationships were discovered? | Derived project knowledge |
| EvidenceGraph | Which reads, claims, and source references support an answer? | Evidence organization; may be NOT_REVALIDATED |
| ProofGraph Kernel v0 | Does a typed DATA/CONTROL/EXECUTION graph satisfy structural invariants? | Structural validation only |
| Execution Proof Graph | Can one supported execution's durable proof records be represented as a bounded graph? | Read-only projection |
| Canonical Proof | Does the exact execution/attempt have accepted, re-derived evidence? | Server-owned proof verdict |
| World Transition / Mission D2 | Has the exact world change materialized under the parent CAS and may the successor proceed? | Existing transition and Mission gates |
| Proof Spine / Operation Evidence | How should current or historical execution evidence be summarized? | Read projection; not a source record |

### Current profile boundary

The deployed Execution Proof Graph profile is runtime_start_gate_c_v1. The projector reloads Canonical Proof and source rows for that direct Runtime Start route. It does not cover Apply, Git Delivery, arbitrary Tasks, Workflows, or all Runtime recipes.

The generic Proof Graph Kernel remains a validator. It must not be fed synthetic Mission/Goal identities to force Mission-free execution into its v0 contract.

### Apply-specific implication

Apply Proof v2 now carries enough new durable source evidence to reconstruct:
- per-attempt server authorization decision;
- deterministic precondition outcomes and Journal references;
- operation/attempt distinction and exact submitted-subset/Hunk digest;
- candidate validation/stability, worker lease, and (for Mission-linked Apply) immutable parent snapshot binding.

However, **Canonical Apply Proof v2 is not an Apply Proof Graph**. No Apply-specific projector/consumer has been verified on main. The next adapter must be read-only, derive every DATA node from reloaded source records, call Canonical Proof and the existing D2 verifier/read-only equivalent, and return NOT_PROJECTABLE on missing, stale, ambiguous, or mismatched evidence.

## 4. Revision domains are not interchangeable

A single project does not have one universal revision. At minimum, the reviewed paths use these domains:

| Domain | What it identifies | Typical source |
|---|---|---|
| Scan / repository manifest revision | Source tree seen by a scanner | Scanner manifest / scan result |
| Workspace tree revision | Actual file-tree content | hashDeliveryTree / Mission workspace revision |
| Candidate revision | Proposed or promoted candidate bytes | Apply proposal and candidate tree hash |
| World State revision | Materialized project facts | World State projection and Transition |
| Mission plan revision | Approved plan contract | Active Mission plan hash |
| Execution attempt | One concrete attempt under a durable execution | Execution row and attempt number |
| Environment revision | Runtime environment identity | Server-derived environment attestation |

A scan revision is not proof that files remain unchanged. A workspace hash is not a World State revision. A successful Acceptance is not a materialized World Transition. A plan hash does not identify an execution attempt.

The Apply v2 split between operationId, applyAttemptId, submittedChangeSetHash, and candidateTreeHash is the right pattern: each digest/identifier has a distinct semantic role and must remain separately bound.

## 5. Context freshness: precise risk, not a blanket failure

### Confirmed safeguards

- runAdmission checks project, operation, project revision, source root, and scan-correlation identity; unbound context slices are dropped.
- Analysis tools independently validate operation/project/revision/root correlation on the inspected paths.
- Cache invalidation is explicit, has a normal 30-second TTL (up to 120 seconds for aggressive mode), and has a PostgreSQL notification hook to evict sibling-process caches.

### Remaining risks

1. buildContextCacheKey does not include a repository/scan manifest fingerprint. Cache hits rebind operation identity and apply lifetime policy but do not recompute the current workspace tree before reuse.
2. contextManifestMatches and contextManifestAllowsExecution are exported and tested helpers; no production caller was found in the bounded workspace source search. They are not a universal enforcement boundary today.
3. Context Links default to fresh / ADMIT; the builder does not consistently map final slice admission and lifetime state back into each link.

These are freshness/provenance risks, not demonstrated acceptance or mutation bypasses. The bounded follow-up is to bind cache reuse to manifest identity or perform a cheap current-revision check, and to make each link inherit its source slice's final status/freshness/admission decision.

## 6. Mission and Workflow are distinct orchestration domains

Mission coordinates Goals, dependencies, plans, Tasks/Recipes, Canonical Proof, World Transitions, and successor release.

Workflow orchestration chooses among phase actions such as advance, wait, fail, or complete, with separate validation and phase execution contracts.

A completed Workflow/phase status must not be equated with a completed Mission Goal, Canonical Acceptance, or accepted project mutation. The product/UI should make this distinction explicit rather than merging the underlying runtime contracts.

## 7. ETV and learning boundaries

This audit did not establish a production, cross-domain Engineering Truth Verification service that continuously reconciles source code, database state, API contracts, graph facts, runtime observations, and documentation as one accepted truth report. Any existing truth:validate-style command or baseline validator must be described only by its own bounded contract unless a source crosswalk proves broader coverage.

Learning and transfer remain gated:
- E3 and E3.2 remain open.
- E2 was closed by the explicit 2026-10-11 stage decision; this does not close the source census.
- Source-family completeness remains UNKNOWN; no total denominator, coverage percentage, or overall score is valid.
- G7 Shadow Mode is not active and has no live cohort.
- G9 improvement is not measurable; G10 generalization readiness has not started.
- P7.5 collection remains gated; fixed_safe_probe is not an automatic learning policy.

## 8. Recommended order

1. **Apply Proof Graph Projector:** build a server-only read adapter for Mission-linked Apply V2; no writes, no new acceptance ledger, no authority changes.
2. **Projector adversarial verification:** missing/duplicate Journal rows, actor/owner mismatch, wrong proposal revision, attempt mismatch, alternate Hunk selection, stale validation, lease expiry, parent drift, missing Transition, row-order determinism, and zero-write assertions.
3. **Revision-bound Context:** bind cached context to the scan/repository manifest and current workspace revision; add cross-process invalidation/race tests.
4. **Context Link fidelity:** propagate source freshness, completeness, admission, and lifetime into each public link.
5. **ETV source contract:** only after defining exact source families, version domains, conflict semantics, and read-only verification boundaries.
6. **Learning/transfer:** only after E3/E3.2, source census, baseline, independent cohort, held-out evaluation, and explicit authority gates close.

Do not change the dependency order in docs/agent-generalization-execution-plan.md §31 through this documentation update.

## 9. Primary source references

- artifacts/api-server/src/lib/agent-state/apply-changes-proof.ts
- artifacts/api-server/src/lib/ai-execution-acceptance.ts
- artifacts/api-server/src/lib/proof-foundation.ts
- artifacts/api-server/src/lib/agent-state/apply-changes-mission-gate.ts
- artifacts/api-server/src/lib/agent-state/runtime-start-transition.ts
- artifacts/api-server/src/lib/execution-proof-graph-projector.ts
- artifacts/api-server/src/routes/runtime.ts
- lib/ai-orchestrator/src/agent-state/proof-graph.ts
- lib/ai-orchestrator/src/agent-state/execution-proof-graph.ts
- lib/ai-orchestrator/src/context-builder.ts
- lib/ai-orchestrator/src/context-cache-manager.ts
- lib/ai-orchestrator/src/context-manifest.ts
- lib/ai-orchestrator/src/context-runtime/context-admission.ts
- lib/ai-orchestrator/src/context-links.ts
- artifacts/api-server/src/lib/ai-analysis-tools.ts
- artifacts/api-server/src/lib/mission-runtime.ts
- lib/ai-orchestrator/src/agents/workflow-orchestrator.ts
- docs/apply-proof-graph-authority-crosswalk.md
- docs/execution-proof-graph-projector-contract.md
- docs/engineering-decision-intelligence-status.md
- docs/e2-source-derived-measurement-ledger.md
- docs/agent-generalization-progress.md