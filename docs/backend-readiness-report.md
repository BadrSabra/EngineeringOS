# EngineeringOS Backend Readiness

**Audit date:** 2026-11-18  
**Scope:** Backend contracts and execution/workspace behavior. Dashboard UI was not changed; only its end-to-end test harness was updated.

## Baseline and scope

- At the start of this audit, GitHub `main` had advanced beyond the local checkout. The backend paths examined here were unchanged by that merge; the review branch for this PR has since been rebased onto current `main`.
- Mission-specific behavior is excluded from this audit because it is not part of the currently supported project contract. No Mission API or state is being added or extended.
- The Workspace snapshot is a read-only projection over existing project/task/execution/candidate/runtime sources; its partial-source behavior and owner checks are covered by route tests.

## Confirmed pre-fix finding

`artifacts/api-server/src/lib/operation-evidence.ts` built an event receipt's `attempt` as `payload.attempt ?? execution.attempt`. A `GitPushed` event is correlated to an operation and may not carry an execution-attempt number; the verified delivery receipt stores an operation identity and remote commit proof, not necessarily a current-attempt identity. The projection therefore labeled an unbound receipt as belonging to whichever attempt happened to be current when the detail endpoint was read. It also ignored an explicit `executionAttempt` value.

The focused test reproduced both cases with an execution at attempt `2`:

- receipt explicitly bound to attempt `1` → projected as attempt `2`;
- receipt with no attempt binding → projected as attempt `2` instead of unknown.

The observed result was `[2, 2]`; the required result is `[1, null]`.

**Boundary:** This is a provenance/projection error. It does not grant write authority or convert the stored evidence verdict to `PROVEN`; the operation-evidence projection remains marked `verified: false`. It can still mislead consumers about which attempt produced a receipt.

The same check found that the runtime projection included internal `readiness` and `proofSpine` fields absent from the OpenAPI contract and generated execution-detail schema. The generated Zod object drops those undeclared fields, so the raw response and generated client disagree. The public projection should remain within the existing contract rather than expanding a retired Mission-oriented surface.

After correcting attempt attribution locally, the contract-parity test exposed a second mismatch: the generated schema retained only `changeSet` and `committed` under `hashes`, while the runtime response also returned `digestVersion`, `baseTree`, `candidateTree`, `promotedTree`, and `commitTree`. The generated client therefore discarded candidate and delivery identity values that the server already computes. These hashes are provenance data; they do not authorize an action.

The broader route check returned **51 passed, 1 failed** across Workspace, SSE, and Preview Build tests. The failing case is an existing scan lifecycle test: its second scan expected `202` but received `409`. An isolated rerun of that exact case passed. The same run also logged the scanner's intentional `root_unavailable (root_unsafe)` rejection for a forged temporary discovery-clone root; it was not shown to cause the `409`. No production change was made for this timing-sensitive observation.

The assigned-task completion checks later passed the dashboard restart smoke, but the release gate blocked on `AI_CONTRACT_AND_JSON_FAILED_1` (classified by its harness as an execution failure), and the separate dashboard journey command exited while reporting progress at 33/67. The isolated `ai.test.ts` case `redacts owner-scoped export and refuses prior-attempt Canonical Proof` reproduced the mismatch: it expected the undocumented `operationEvidence.proofSpine`, which the public projection intentionally omits. Its separate `operationEvidence.proof` assertions still required a non-`PROVEN` verdict and failure reasons. The stale assertion was updated to verify that internal fields stay absent; the isolated case now passes. The full completion gate has not been rerun after this test-only correction.

## Remediation delivered

1. Preserve an event's explicit execution attempt; use `null` when it is not bound to one.
2. Keep `readiness` and `proofSpine` internal and return only the intended public Operation Evidence contract.
3. Declare all emitted candidate/delivery hashes and receipt fields in OpenAPI, regenerate the API client, and verify the response against that generated contract.

The projection remains explicitly `verified: false`; this change fixes provenance and contract shape, not proof acceptance, Preview qualification, or permission to apply changes.

## Gap matrix

| Area | Finding | Status and evidence | Action / limit |
|---|---|---|---|
| Workspace snapshot | Existing read-only snapshot combines project work, latest execution, candidate, and runtime while reporting per-source availability and freshness. It previously selected the latest project candidate independently of the latest execution without stating whether they were linked. | Confirmed in `projects.ts`; the earlier tests covered only the matching case. A follow-up now covers matched and mismatched proposal identities, and the existing partial-source and ownership cases still pass. | `latestExecutionBinding` makes the exact identity relation explicit; it does not assert verification, acceptance, Apply, or Delivery. |
| Workspace task verification | The projection copied a stored Task verification decision without checking whether it agreed with the current Task status; a queued retry could therefore still appear verified. | Reproduced through `GET /api/projects/{projectId}/workspace`: a `queued` Task with a prior `verified` result returned `verified`. Fixed and covered by route and helper tests. | The decision is now `null` during pending/queued/running work and whenever it conflicts with the Task status; `verifying` + `incomplete` and matching terminal decisions remain available. This is status consistency, not revision-bound proof. |
| Workspace event stream | Events are bounded invalidations with cursor/reconnect handling and project ownership checks. | Confirmed by `workspace-events.test.ts` in the combined route run. | Treat events as a reason to re-fetch, not as authoritative state. |
| Tasks and execution | Existing task/execution detail routes expose execution identity, attempt, acceptance/proof summary, timeline, recovery, and delivery projections. | Confirmed by code inspection and `ai-execution-projection.test.ts` (10 tests passed alongside Operation Evidence tests). | Stored evidence-status fields are projections; the detail path explicitly does not revalidate them. Do not render them as new proof. |
| AI request availability | The API starts, but its startup validator found no configured AI provider. | Confirmed by the restarted API's startup log: AI features return `428` until a provider is saved through the existing settings flow. | Operational blocker remains; no provider credentials were requested or changed in this audit. |
| Candidate, verification, and evidence | Candidate identity and tree hashes already flow through the execution evidence projection, but several hash fields were absent from OpenAPI and generated types. | Confirmed mismatch, corrected in this change; generated Zod parsing now retains all emitted hashes and receipt attempts. | A receipt with no exact attempt binding is `null`, not attributed to the latest execution attempt. |
| Acceptance, Apply, and recovery | Acceptance/proof and recovery are separate existing records; the detail projection alone does not establish that an Apply is currently authorized. | No new authorization path was added. The public evidence response remains `verified: false`; end-to-end Apply eligibility was not revalidated in this audit. | Keep server-owned acceptance and mutation gates authoritative. |
| Preview qualification | The existing Preview Build route is candidate-bound and checks ownership, stale candidates, and active-build conflicts. | Its route tests passed in the combined route run. Full builder/attestor/runner qualification was not exercised. An open Preview runner PR is also under review. | Do not treat a queued build or existing candidate as Preview-qualified. |
| Delivery | The GitHub delivery service verifies remote state before recording delivery receipts. | `github-delivery-service.test.ts`: 5 passed. Operation Evidence now preserves the remote identity hashes and never fabricates an attempt binding. | A delivery receipt is not Canonical Proof; `verified` remains false here. |

## Contract and compatibility

- OpenAPI remains the source of truth. The generated React API schema and Zod response schema were regenerated; `pnpm run codegen:check` passed.
- No top-level version bump was made: `receipts` was previously an untyped, free-form array in the declared contract, so its new explicit nullable attempt field and the added hash properties clarify emitted data rather than changing a typed receipt field.
- `attempt: null` means the event was not bound to an execution attempt. Clients must not substitute the current attempt.
- Workspace candidate `latestExecutionBinding` is `matched` only when its proposal ID equals `latestExecution.proposalId`; `not_matched` means it is not identified as that execution's output; `unknown` means the execution source could not be read. This additive field leaves `contractVersion` at 1 and does not change proof or lifecycle authority.
- `readiness` and `proofSpine` remain internal and are no longer returned by the public redacted projection. They were absent from OpenAPI and generated clients already discarded them; raw clients relying on those undocumented fields will need to use the declared proof/receipt fields instead.
- The Operation Evidence and Workspace-summary slices add no database schema, permission gate, proof acceptance rule, or mutation route. Archive upload work has its own schema changes; only the Dashboard E2E harness changed, not its UI.

## Backend → Frontend handoff

- `GET /api/projects/{projectId}/workspace` is read-only. It can return partial source freshness with warnings while still returning available sections; missing runtime data is unavailable, not healthy. A source event should invalidate the snapshot and trigger a re-fetch.
- On that workspace snapshot, compare the candidate's `latestExecutionBinding` before describing it as the result of the latest run. `matched` proves only the proposal-ID link; `not_matched` and `unknown` must remain distinct, and none of these values proves verification or approval.
- `work.recentTasks[*].verificationDecision` is exposed only when it is consistent with that Task's current state: `verifying`/`incomplete`, `completed`/`verified`, `failed`/`failed`, or `cancelled`/`cancelled`. It is `null` during pending, queued, or running work and for mismatched/legacy data; it is not a revision-bound proof.
- `GET /api/ai/executions/{executionId}` exposes the declared execution detail contract. Read `operationEvidence.hashes` for nullable digest/tree identities, and `operationEvidence.receipts[*].attempt` for the exact attempt or `null`. Do not read internal `readiness`/`proofSpine` fields or interpret `verified: false` as proof.
- Canonical proof verdicts are `PROVEN`, `INCOMPLETE`, or `UNAVAILABLE`; a stored evidence-status projection is not a live revalidation. Acceptance and Apply states must continue to come from their existing server-owned records and gates.
- Preview Build requests remain candidate-bound. A queued build does not mean qualified; stale/active conflicts remain conflicts, and ownership failures remain errors. The full build/attestation path was not verified in this audit.
- No Dashboard UI files were changed. Generated client types now represent all Operation Evidence hash fields and nullable receipt attempts.

## Verification

| Check | Result |
|---|---|
| Pre-fix Operation Evidence tests | 2 failures reproduced: event attempts were `[2, 2]` instead of `[1, null]`; raw response included fields not declared by the generated contract. |
| `pnpm run codegen` | Passed; generated React/Zod clients and library typecheck completed. Orval also reported existing nullable-`$ref` warnings elsewhere in the OpenAPI file. |
| `pnpm run codegen:check` | Passed; OpenAPI parses and generated files are in sync. |
| `pnpm --filter @workspace/api-server run typecheck` | Passed after fixing two type errors identified in the first typecheck attempt. |
| Focused Operation Evidence and execution projection tests | 16 passed. |
| `ai.test.ts` audit-export regression | Before test correction: 1 failed because it expected `proofSpine`; after correction: 1 passed, 241 skipped. |
| AI route parity and full AI route tests | 245 passed across `ai-route-parity.test.ts` and `ai.test.ts` after the assertion correction. |
| `github-delivery-service.test.ts` | 5 passed. |
| Workspace, SSE, and Preview Build route tests | Combined run: 51 passed, 1 failed (`projects.test.ts` second-scan case received 409 instead of 202). Isolated rerun of that exact case passed (1 passed, 41 skipped); treat the combined-run result as timing-sensitive, not as a confirmed regression. |
| Integration / E2E | The legacy Operation Evidence integration test was excluded. The task validator's dashboard restart smoke passed and its nested Preview dashboard check passed; the separate dashboard journey stopped at 33/67. The full release gate was not rerun after the isolated assertion correction. No end-to-end acceptance, Apply, or Preview qualification claim is made. |
| Replit API workflow | Restarted successfully; `GET /api/healthz` returned `200`. Startup logs explicitly report that AI features return `428` until a provider is configured. |

## Follow-up slice: Workspace candidate binding

The workspace route reads the latest execution and the latest project candidate independently. Since an execution may point to an older proposal than the project's newest candidate, the response now declares `latestExecutionBinding` as `matched`, `not_matched`, or `unknown`. The exact proposal ID comparison is the only authority for `matched`; no verification or approval claim is derived from it.

Verification for this slice: `pnpm --filter @workspace/api-server run typecheck`, `pnpm --filter @workspace/dashboard run typecheck`, and `pnpm run codegen:check` passed. The focused Workspace/project route and pure binding tests passed (47 tests). The generated React API schema and server Zod response schema are in sync; no dashboard source files changed.

At implementation time, the live `main` reviewed for this follow-up was `b01cbce`; later `main` updates were synchronized locally as described under **Latest GitHub sync**.

## Pre-fix reproduction: stale Workspace task verification

The Workspace projection copied `task.verificationResult.decision` without checking whether it agreed with the Task's current status. A route test seeded a `queued` Task with an earlier `verified` result; `GET /api/projects/{projectId}/workspace` returned `verificationDecision: "verified"` instead of `null`. The same test also covers the valid `verifying` + `incomplete` pair and a terminal status/result mismatch.

**Boundary:** This reproduces a stale read-model value in the Workspace snapshot only. It does not show that stored verification is stale for every Task, and it does not demonstrate an Apply authorization or Canonical Proof bypass. The correction must keep active/mismatched verification out of the current summary without changing the underlying Task history or trust gates.

The first post-change helper run also found that an absent decision returned `undefined` instead of the contract's explicit `null` (4 of 5 helper cases passed). This was limited to empty-input normalization in the new projection helper; the route regression test already passed.

## Follow-up slice: current Task verification summary

The Workspace Task summary now projects a verification decision only when it matches the Task's current state. It keeps the existing OpenAPI shape (`verificationDecision` is nullable), documents the freshness semantics in OpenAPI, changes no stored Task history or authorization/proof gate, and does not modify `artifacts/dashboard/**`.

After the fix, `pnpm --filter @workspace/api-server exec vitest run src/lib/workspace-snapshot.test.ts` passed (5 tests), the complete `projects.test.ts` route file passed (45 tests), and `pnpm --filter @workspace/api-server run typecheck` passed. The focused route regression test passed after first reproducing the stale `verified` value. `git diff --check` also passed.

After documenting the freshness semantics in OpenAPI, the first `pnpm run codegen:check` detected that generated Zod and React schemas needed regeneration. The API-server and Dashboard typechecks passed before regeneration; this was generated-artifact drift only, not a runtime or source type failure.

For this slice, live GitHub `main` was rechecked at `fe04c4d`; the commits after `b01cbce` were dashboard-only. The open Backend PRs reviewed (#28, #36, #42, #46, and #24–#25) did not touch `projects.ts` or its route tests. No PR was created for this local slice.

## Repository and pull-request review (initial audit)

- GitHub App access is available. Live `main` is `60875a23d5618bffc29e3405fe77be709e01d521`. The eleven commits after the previously observed `a0638fb` modify dashboard files only, so they do not overlap this backend change.
- Local `main` is `96797dad2096e7cc344b34f5bf65eb9527d578b7`, eight commits ahead of stale local `origin/main`; it is not used as the PR base.
- Open PRs reviewed by file list: #46 covers a broad Preview runner/build path; #36 and #28 touch execution/chat paths; #42 is an Apply proof-graph path. None directly edits the Operation Evidence/OpenAPI implementation files changed here. This PR's test-only `ai.test.ts` assertion overlaps a file listed by #28 and #36, so recheck that hunk if either merges first. Dashboard-only PR #51 does not overlap.
- GitHub rate-limited file enumeration for older open PRs #24–#27, so their exact file overlap was not confirmed. The review branch must be created from the live `main`, not the stale local ref.
- The change was packaged as a single review commit based on live `main`; that was the state at the time of the initial audit.

## Latest GitHub sync

- GitHub `main` at `8a9985a` was merged into local `main` with merge commit `79dfdbc`; earlier local commits were preserved.
- The only merge conflict was this readiness report. It was resolved by retaining the local audit findings and adding the newer GitHub updates; the incoming Dashboard and workflow changes were integrated.
- Before review, the local-only changes were rebased onto live GitHub `main` at `077da21`. Its four newer commits changed only the Missions Dashboard page and tests, with no overlap in this review branch.
- The review branch is isolated from local `main`; it has not been pushed or opened as a pull request yet.
