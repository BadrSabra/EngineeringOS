# Execution Proof Graph Projector — Implementation Contract

**Status:** PGP-01–PGP-05 implementation is present on main at 5103e66368e181c3fa00d11d00ea25e51677e070 with scoped validation; this contract does not authorize extending the supported profile
**Scope:** one authenticated `runtime.start` execution using `runtime_start_gate_c_v1`, on one exact attempt
**Authority:** read-only projection; Canonical Proof and existing acceptance gates remain authoritative  
**Persistence:** none; do not create graph tables, a second acceptance ledger, or a parallel evidence store

## 1. Decision

Build a server-owned projector that derives a bounded, deterministic graph from the existing durable execution and proof records. The graph explains how those records relate; it does not create, improve, or replace proof.

The first slice is the currently supported, direct project Runtime Start route (`POST /projects/:projectId/runtime/start`) and its `runtime_start_gate_c_v1` execution attempt. This route does not require a Mission or Goal. Its Gate C proof is reloaded by `loadCanonicalProof` from the exact execution, acceptance, evidence snapshot, Episode, action events, effect bundle, effect, and direct observations. It does not attempt to represent every Task, chat turn, Recipe, delivery, Runtime transition, or mutation in one universal graph. Apply Changes now has a separate Canonical Apply Proof v2 artifact, but that artifact is not part of this Runtime Start graph profile and does not imply an Apply Graph Projector exists.

The existing `ProofGraph` kernel is a structural validator, not a projector. Its v0 schema requires Mission/Goal identities and a World/Workspace mutation shape. Do not fill those required fields with synthetic values to make a Mission-free execution fit. Keep v0 isolated and introduce a versioned successor contract in the existing proof-graph module only if the source crosswalk confirms the fields and invariants.

## 2. Current system boundaries

The implementation must preserve these distinctions:

1. **Canonical Proof** is the server-owned verdict composed from the exact execution, acceptance, and evidence snapshot. `loadCanonicalProof` is the source-reload boundary.
2. **Execution Proof Projection** is bounded acceptance metadata. Its references and digest do not independently prove that their underlying records exist or match.
3. **EvidenceGraph** connects reads, claims, symbols, and sub-queries. Its `EVIDENCE_GRAPH_ONLY` / `NOT_REVALIDATED` projection is not execution proof.
4. **Proof Graph** is a derived, typed relationship view. Its structural validator may return only `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY`.
5. **Operation Evidence** is a user-facing summary. Its current related rows are read through separate queries; do not use that assembled projection as the projector's authoritative snapshot.

No incoming graph, provider output, checkpoint field, dashboard cache, serialized `PROVEN` label, or `ProofSpine` summary may be treated as a source record.

## 3. Supported first-slice scope

### Included

- One server-authorized project.
- One `ai_execution` ID and one explicit attempt number.
- The stored request must select `runtime_start_gate_c_v1`, and the durable recipe receipt must identify `runtime.start` version 1.
- The exact current execution identity and its existing `ai_execution_acceptances` row.
- The exact linked `ai_execution_evidence_snapshots` row. This proof mode records no source-file reads; its required evidence is the Gate C artifact plus direct observations.
- The exact `ai_agent_episodes` row, `ACTION_REQUESTED` and `ACTION_COMMITTED` events, `ai_agent_effect_bundles` row, `ai_agent_effects` row, and referenced `ai_agent_observations` rows.
- The server-rederived `runtime_start_gate_c` artifact, accepted only when its canonical hash matches the sole stored artifact in the evidence snapshot.
- A read-only projection for one execution detail/evidence consumer.

### Excluded

- Mission- or Goal-dependent assumptions and fabricated IDs.
- Other proof modes, including Apply Changes, generic evidence acceptance, restart/stop recipes, and Mission-linked runtime orchestration. They require their own source crosswalk before inclusion.
- Arbitrary provider/model graphs or client-submitted graphs.
- A replacement for Canonical Proof, Task acceptance, delivery acceptance, or any mutation gate.
- Writing graph rows, changing acceptance, materializing World State, applying files, dispatching work, or waking successors.
- Treating `toolTrace`, raw logs, source bodies, or a recipe receipt alone as proof.
- A universal graph for every execution family before each family has its own source crosswalk and verifier.

## 4. Request and authorization contract

The projector accepts only server-resolved identity:

```ts
type ProjectExecutionProofGraphInput = {
  projectId: string;
  executionId: string;
  expectedAttempt: number;
};
```

The authenticated controller must first establish that the requester may access `projectId`, then pass only server-validated identifiers to the projector. The projector reloads the execution by both `executionId` and `projectId`; it must not infer a project from a client-supplied graph or use a same-ID record from another project.

`expectedAttempt` is mandatory. If it differs from the durable execution attempt, return `NOT_PROJECTABLE` with a bounded `ATTEMPT_MISMATCH` reason. Never silently substitute the newest attempt.

## 5. Result contract

The result is discriminated and contains no raw source material:

```ts
type ExecutionProofGraphResult =
  | {
      kind: "NOT_PROJECTABLE";
      contractVersion: number;
      authority: "READ_ONLY_PROJECTION";
      executionId: string;
      expectedAttempt: number;
      reasons: Array<
        | "EXECUTION_NOT_FOUND"
        | "ATTEMPT_MISMATCH"
        | "ACCEPTANCE_MISSING"
        | "EVIDENCE_SNAPSHOT_MISSING"
        | "IDENTITY_MISMATCH"
        | "REVISION_MISMATCH"
        | "EVIDENCE_INVALID"
        | "DOMAIN_PROOF_MISMATCH"
        | "EXECUTION_NOT_COMPLETED"
        | "UNSUPPORTED_PROOF_MODE"
      >;
    }
  | {
      kind: "PROJECTED";
      contractVersion: number;
      authority: "READ_ONLY_PROJECTION";
      graph: ExecutionProofGraph;
      graphHash: string;
      canonicalProof: PublicCanonicalProofProjection;
      structuralValidation: {
        authority: "STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY";
        verdict: "PASS" | "FAIL";
        violations: BoundedGraphViolation[];
      };
    };
```

Missing or identity-conflicting source records produce `NOT_PROJECTABLE`; do not invent sentinel nodes or default missing evidence to fresh, direct, complete, accepted, or satisfied. If all referenced records exist and bind correctly but a recorded control/outcome failed, the graph may be projected with that actual outcome and structural `FAIL`.

`PROJECTED` does not mean Canonical Proof is accepted. The canonical verdict is shown separately and is never derived from the graph's structural verdict.

## 6. Source loading and identity binding

Load the graph sources through one server-owned database read boundary with explicit consistency semantics. Reuse `loadCanonicalProof` inside that boundary instead of reimplementing its acceptance rules.

The source adapter must verify, before graph construction:

1. The execution ID, project ID, and expected attempt match the locked durable execution row.
2. The acceptance row matches the same execution, project, and attempt.
3. The evidence snapshot ID referenced by the acceptance matches the same execution, project, and attempt.
4. Operation ID, source revision, candidate identity, proof mode, and delivery identity are copied only from reloaded server-owned rows and validated against Canonical Proof.
5. For this first slice, the request proof mode is exactly `runtime_start_gate_c_v1`; the recipe receipt is completed `runtime.start` v1 and binds execution, attempt, operation, and source revision.
6. The Gate C verifier must rederive the artifact from the exact Episode, one matching requested and committed action event, the observed effect bundle and its single effect, and the referenced observations. The verifier checks their project/execution/attempt/Episode bindings, canonical payload hashes, source/environment revisions, direct-observation freshness and completeness, and the runtime-serving/process-attestation outcome.
7. The stored evidence snapshot must be required, complete, `PROVEN`, bound to the same operation/source revision/candidate, and contain exactly one valid `runtime_start_gate_c` artifact. `loadCanonicalProof` must independently rederive that artifact and compare its canonical hash to the stored artifact.
8. `runtime.start` Gate C proof is separate from post-acceptance World State transition materialization. Do not make a transition a prerequisite for this graph, and do not treat its presence as additional proof.
9. This mode has no source-file evidence reads. If a later profile includes such reads, each read must belong to the exact snapshot; where required, verify metadata version, completeness, non-truncation, byte length, and the private body’s SHA-256 before projecting a digest/reference.
10. The result is assembled from the same read boundary. Do not join a previously loaded `AiExecution` object, `OperationEvidenceProjection`, or cached proof summary with rows fetched later.

The graph contains opaque record references, safe hashes, typed statuses, and identity bindings only. It must not contain evidence bodies, absolute paths, local workspace roots, provider payloads, credentials, raw logs, or arbitrary diagnostic strings.

## 7. Graph contract

The successor graph contract must be versioned and typed. It must not mutate v0's meaning in place.

### Required root identity

- `projectId`
- `executionId`
- `attempt`
- `operationId` when persisted
- `linkedTaskId` when persisted
- source revision and candidate identity only when bound by the canonical source records

No Mission or Goal identity is required. If a future domain needs those identities, add them as optional, server-derived extension data with a separate contract—not as required fake placeholders.

### PGP-02 node families

The successor schema is `ExecutionProofGraphSchema` in the `agent-state` contract module. It is deliberately separate from the unchanged Mission-linked `ProofGraphSchema` v0.

- `EXECUTION`: completed `runtime.start` execution, exact operation, attempt, source revision, and nullable candidate identity.
- `ACCEPTANCE`: the matching completed successful acceptance with required, complete evidence.
- `EVIDENCE_SNAPSHOT`: the exact proven snapshot and digest of its single Gate C artifact.
- `GATE_C_ARTIFACT`: artifact version and safe identity/hash references only; no workspace root or raw observation values.
- `EPISODE`, `ACTION_EVENT`, `EFFECT_BUNDLE`, `EFFECT`, and `OBSERVATION`: exact verifier-bound records, with observations limited to fixed predicates, direct provenance, freshness/completeness, revisions, and a value digest.

All nodes repeat the project/execution/attempt binding for structural cross-checking. IDs are deterministic hashes of a typed kind and its opaque record identity; graph IDs derive from the profile and execution attempt. Graph and node inputs are strict, byte-bounded schemas. The validator rechecks identity/revision agreement, required-node cardinalities, Gate C observation sets, direct/fresh observation state, and semantic edges. Raw observation values, process details, paths, and credentials are never fields in this contract.

### PGP-02 edge families

- `EXECUTION_HAS_ACCEPTANCE`; `ACCEPTANCE_HAS_SNAPSHOT`; `EXECUTION_HAS_EPISODE`.
- `EPISODE_HAS_EVENT`; `EPISODE_HAS_EFFECT_BUNDLE`; `BUNDLE_HAS_EFFECT`.
- `EFFECT_HAS_OBSERVATION` with before/after role.
- `SNAPSHOT_HAS_ARTIFACT`.
- `ARTIFACT_BINDS_EVENT`, `ARTIFACT_BINDS_EFFECT_BUNDLE`, `ARTIFACT_BINDS_EFFECT`, and `ARTIFACT_BINDS_OBSERVATION`.

The validator rejects dangling/wrong-type edges, missing or extra semantic edges, duplicate edges, cross-project/attempt references, stale observations, and revision drift. Canonical ordering and hashes use code-point ordering so results do not depend on database row order or host locale.

## 8. Hashing, freshness, and authority

- Hash the canonical typed graph after deterministic node/edge ordering.
- Recompute content digests from the authoritative source record or private evidence body; an ID or stored hash string alone is not content verification.
- The PGP-02 validator checks declared graph structure only. It cannot recompute source-row hashes or authenticate observations; PGP-03 must populate the graph from reloaded records and invoke the existing Canonical Proof/Gate C verifier before returning it.
- Freshness is derived from server-owned source state and the relevant revision comparison. Unknown freshness remains unknown and cannot be promoted to fresh.
- Keep the existing constant authority label `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY` on the structural validator.
- Keep the projector label `READ_ONLY_PROJECTION`; neither label may be mapped to Canonical Proof, `PROVEN`, delivery success, or mutation authorization.
- Projection must have no database writes. A before/after query or acceptance check must show no change to acceptance, execution, Task eligibility, or delivery state.

## 9. Package sequence and closure

### PGP-01 — Current-scope source crosswalk

The first supported profile is `runtime_start_gate_c_v1`, exercised by the direct project Runtime Start route. The route hashes the current project tree, calls the server recipe runner for `runtime.start` v1, and does not pass Mission/Goal IDs. Do not infer support from Mission runtime tests or old Mission-linked Apply documents.

| Projected record / claim | Durable source of truth | Existing verifier and required binding |
| --- | --- | --- |
| Execution root | `ai_executions` plus parsed stored request | `executionId`, `projectId`, `attempt`, `operationId`, `workspaceRoot`, `baseRevision`, and `recipeProofMode` agree; request and execution revisions agree. `loadCanonicalProof` locks and reloads the execution. |
| Recipe completion | `ai_executions.recipeReceipt` | Completed `runtime.start` v1 receipt binds the same execution, attempt, operation, and source revision. A receipt alone is never proof. |
| Revision identity | Request `workspaceRevision`, `ai_executions.baseRevision`, acceptance `sourceRevision` | All equal; source revision is either the supported workspace-tree digest or a Git commit object ID, classified by `classifyRuntimeStartGateCSourceRevision`. No path/root is emitted; `workspaceIdentity` is a canonical digest over project, operation, root, revision, and candidate identity. |
| Episode | `ai_agent_episodes` | Exactly the row for project/execution/attempt; its project revision matches. On acceptance reload it must be completed and achieved with reason `CANONICAL_PROOF_PROVEN`. No Mission/Goal identity is needed. |
| Requested and committed action | `ai_agent_episode_events` | Exactly one `ACTION_REQUESTED` and one `ACTION_COMMITTED` for the deterministic Gate C action ID, within the same project/execution/attempt/Episode. Rebuild the action and contract from server-owned inputs; recompute both payload hashes; require the commit status `passed`. |
| Effect bundle and effect | `ai_agent_effect_bundles`, `ai_agent_effects` | Bundle is `OBSERVED`, exact identity-bound, and contains exactly one effect. Effect is observed, has the expected runtime capability/action ID and matching effect-contract hash; bundle contract hash and before/after references must match. |
| Before/after observations | `ai_agent_observations` referenced by the effect | Exact project/execution/Episode and revision/environment bindings; direct, complete, fresh observations only. Verify the stopped/running pre-state, passed serving check, live process, ready listener, and known process attestation using `deriveRuntimeStartGateCProof`. Keep IDs and safe digests only. |
| Acceptance and evidence snapshot | `ai_execution_acceptances`, `ai_execution_evidence_snapshots` and snapshot artifact references | Same execution/project/attempt; completed `SUCCEEDED` acceptance with required, complete evidence; snapshot binds operation/revision/candidate. `loadCanonicalProof` rederives the Gate C artifact and requires exactly one stored artifact with identical canonical hash. |
| Canonical verdict | Result of `loadCanonicalProof` | Display independently from graph structure. The projector must not translate structural `PASS` into `PROVEN`. |

**Explicitly not in PGP-01:** source-file bodies/read nodes (this mode has no source reads), World State transitions, Missions/Goals, generic `ProofGraph` v0, Apply/Delivery proofs, and other Runtime recipes. If any required row is absent, stale, ambiguous, or inconsistent, return `NOT_PROJECTABLE`; do not degrade to a success-shaped graph.

**Close when:** every projected field has the named source and verifier above; a direct non-Mission `runtime.start` fixture passes through acceptance and `loadCanonicalProof`; unsupported modes have explicit `NOT_PROJECTABLE` reasons. Graph-level tampering outcomes are verified later in PGP-03.

### PGP-02 — Versioned graph contract

Add the Mission-free `runtime_start_gate_c_v1` typed contract and pure deterministic structural validator under the existing `agent-state` contract family. Preserve v0 fixtures and semantics; keep both validators' authority label at `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY`.

**Close when:** new profile tests cover strict schema and byte/node/edge limits, deterministic IDs and canonical hash, identity/revision mismatch, required-node cardinality, observation freshness and binding, duplicate/wrong-type/dangling/missing/unexpected edges, and permutation stability; the existing v0 suite and package typecheck remain green.

### PGP-03 — Read-only server projector

Implement one server-only source adapter that reloads and verifies records through the existing Canonical Proof boundary, constructs the graph, and validates it without persistence.

**Implementation status:** implemented on main (5103e66368e181c3fa00d11d00ea25e51677e070) as a transaction-scoped server function. It locks the execution, acceptance, and evidence snapshot; revalidates Canonical Proof before and after locking the Gate C source rows; recomputes observation value hashes; builds and validates the graph; and performs no writes. The single authenticated API read path is tracked separately in PGP-04.

**Closure evidence:** API typecheck passes. PostgreSQL-backed projector tests pass for positive projection and repeat-stable graph hash, wrong project, wrong attempt, missing bound observation, tampered observation digest, revision drift, and an update blocked until the caller transaction commits. These checks establish the PGP-03 projector boundary only; they do not close PGP-04 or PGP-05.

**Close when:** the listed PostgreSQL-backed cases pass and a repeated read returns the same graph hash. Keep the consumer and rollout criteria in PGP-04 and PGP-05.

### PGP-04 — Single authenticated consumer

Expose the result only through one project-authorized execution-detail/evidence read path. Keep current evidence and acceptance UI semantics separate.

**Implementation status:** implemented on main (5103e66368e181c3fa00d11d00ea25e51677e070) as `GET /projects/:projectId/executions/:executionId/proof-graph/attempts/:attempt`, guarded by the existing project-ownership middleware. It requires an explicit non-negative attempt in the path and returns the read-only graph result separately from Canonical Proof. AI Chat offers an on-demand display only when a successful terminal projection matches the exact assistant execution; it does not poll, change a verdict, or affect execution eligibility.

**Closure evidence:** authenticated PostgreSQL-backed route tests pass for the authorized owner, foreign project owner denial, missing attempt, and an execution/project mismatch. The accepted response keeps `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY` separate from the canonical `PROVEN` summary and excludes workspace roots, process IDs, ports, and runtime session IDs.

**Close when:** unauthorized access returns no graph; the response contains no bodies, local paths, provider payloads, secrets, or raw logs; structural PASS cannot alter the displayed canonical verdict or any execution eligibility. Dashboard integration remains outside this package.

### PGP-05 — Regression and rollout gate

Run the isolated Kernel suite, API typecheck, API integration tests, relevant authenticated route tests, and existing Canonical Proof tests.

**Current scoped validation:** API typecheck passes; the full Runtime route integration file passes (18 tests), including fail-closed cases for a missing acceptance, a missing or cross-linked snapshot, unsupported proof mode, failed or misbound recipe receipts (wrong execution or attempt), candidate/source-revision drift against the unchanged Gate C artifact, tampered Gate C artifact identity, incomplete snapshot metadata, and an unbound extra artifact. Candidate and source-revision drift are rejected as `DOMAIN_PROOF_MISMATCH` when the stored Gate C artifact no longer matches the acceptance identity. Canonical Proof and `runtime.start` Gate C contract files pass (28 tests); Execution Proof Graph v1 and unchanged Proof Graph v0 suites pass (48 tests). The authenticated consumer tests are included in the Runtime route file. The direct Gate C plus Shadow Replay integration test also passes when its test-only signed UDS supervisor fixture is provisioned with bounded roots and its environment is restored after the test. `git diff --check` passes. This is focused PGP validation, not a claim that the entire API suite is green.

**Main/CI confirmation (2026-11-17):** GitHub Actions run #856 (https://github.com/BadrSabra/EngineeringOS/actions/runs/43985363575) on 5103e66368e181c3fa00d11d00ea25e51677e070 passed the Validate Proof Graph Kernel v0 step, all-package typecheck, and repository test step. The same run passed the dedicated independent-PostgreSQL-session Apply recovery proof. Its Release validation job was skipped; this does not establish Release Validation.

**Close when:** the required focused checks pass and no broad dashboard polling or graph persistence has been introduced. PGP-01 through PGP-05 are implemented on main with scoped validation complete. The entire API suite was not run and is not claimed green; broader unrelated suite failures remain outside this package. A Kernel-only pass is not closure for the projector.

## 10. Required adversarial tests

- No acceptance, missing or cross-linked snapshot, deleted snapshot, and unsupported proof mode return `NOT_PROJECTABLE`.
- A stale attempt cannot be replaced with the current attempt or vice versa.
- Wrong project, execution, operation, candidate, source revision, or snapshot identities fail closed.
- Tampering with a stored evidence hash, body, metadata version, completeness flag, or truncation flag is rejected where that evidence is required.
- An unrelated, stale, or failed receipt cannot be linked merely because its ID is known.
- Randomized row order produces the same graph hash and ordered violations.
- Repeated reads do not create or modify records.
- No graph field can satisfy Canonical Proof or unlock Apply/Delivery.
- Response serialization contains no source body, absolute path, workspace root, secret, provider payload, or raw log.

## 11. Current blockers and implementation guardrails

1. `ProofGraph` v0 is a structural validator with Mission/Goal and mutation-specific requirements; it is not the execution projector. The first successor profile is the Mission-independent `runtime_start_gate_c_v1` path only.
2. The existing `ProofSpine` is a compact proof summary, not a graph; the existing `EvidenceGraph` is a read/claim graph, not execution proof.
3. The existing `OperationEvidenceProjection` is not a consistent source snapshot and must not be used as the projector's authority.
4. The current Mission-linked Apply crosswalk is a separate source contract. Apply Proof v2 is not included in this Runtime Start projector; an Apply graph requires its own adapter and tests, and must not be inferred from this profile.
5. No production consumer may interpret graph `PASS` as proof acceptance.
6. Validation boundary: the focused non-Mission workspace-tree `runtime.start` test passes through acceptance and `loadCanonicalProof`. The broader `derives runtime.start Canonical Proof from Gate C before the separate World State transition` test initially received `runner_blocked` because this workspace has no configured secure UDS Runtime Supervisor. The test now provisions the existing test-only signed UDS fixture, limits it to the project fixture and disposable temp root, and restores the prior environment; the replay then reaches the mutation check and the expected `replay_identity_mismatch` assertion passes. Production supervisor requirements and proof authority are unchanged.

**Implementation order:** PGP-01 → PGP-02 → PGP-03 → PGP-04 → PGP-05. PGP-01 through PGP-05 are implemented on main with scoped validation complete. Do not interpret graph structural PASS as Canonical Proof or mutation authority.
