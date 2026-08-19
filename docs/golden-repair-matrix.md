# Golden Repair Matrix

Task 174 verifies that a repair cannot become successful merely because a
provider returned, a process restarted, or a user workspace drifted.

The matrix is deterministic and provider-free. Each case asserts a terminal
state plus the evidence invariant that makes that state trustworthy.

| Adversarial condition | Required terminal behavior | Proof |
| --- | --- | --- |
| Validation fails, then bounded repair succeeds | Retry with bounded attempt count; only passed validation reaches `passed` | `golden-repair-matrix.test.ts` |
| Validation keeps failing | `blocked`; no completed nodes and no false success | `golden-repair-matrix.test.ts`, `ai-repair-loop-e2e.test.ts` |
| Worker is interrupted while a node is running | Preserve the running snapshot; recovery retries it from its attempt count | `golden-repair-matrix.test.ts`, `execution-node-coordinator.test.ts` |
| Cancellation arrives before work starts | Terminal `cancelled`; no node callback runs | `golden-repair-matrix.test.ts`, `ai-stream-integration.test.ts` |
| Cancellation arrives during provider/command work | Abort the boundary; late success is not accepted | `golden-repair-matrix.test.ts`, `execution-kernel.test.ts` |
| Required prerequisite evidence is unavailable | Block the prerequisite and all dependent nodes | `golden-repair-matrix.test.ts` |
| User edits the same hunk during a paused repair | Ambiguous rebase fails closed; no overwrite | `golden-repair-matrix.test.ts`, `patch-contract.test.ts`, `ai-stream-integration.test.ts` |
| Validation command times out or emits excessive output | Bounded non-success result; never validation proof | `golden-repair-matrix.test.ts`, `execution-kernel.test.ts` |
| Provider emits malformed tool arguments or output | Preserve the parse failure; no pending patch and no success claim | `golden-repair-matrix.test.ts`, Code Agent benchmark `malformed-output` case |
| Proposed patch escapes the approved scope | Reject the change and retain a bounded scope-escape explanation | `golden-repair-matrix.test.ts`, Code Agent benchmark `scope-safety` case |
| Success claim has no executable behavioral proof | Remain `blocked`; a model claim cannot close the benchmark oracle | `golden-repair-matrix.test.ts`, Code Agent benchmark `blocked-proof` case |
| Checkpoint scope/attempt/status is stale or mixed | Reconciliation returns no plan; resume does not schedule stale state | `ai-stream-integration.test.ts` |
| Overlay validation receives pending content | Source workspace remains unchanged while the overlay is tested | `ai-repair-validation.test.ts`, `ai-repair-loop-e2e.test.ts` |

## Invariants

- A callback resolving is not evidence of a passed repair.
- `cancelled`, `blocked`, `timed_out`, and `failed` never count as validation
  success.
- A checkpoint can advance progress only when its node identity, scope,
  dependencies, validation profile, and attempt counters still match the
  server-owned plan.
- Rebase ambiguity is a conflict, not permission to overwrite user edits.
- Validation runs against pending content in an isolated overlay; the live
  workspace is not the validation target.
- Every interrupted or cancelled path remains resumable or terminally
  explainable. None may surface `READY_FOR_REVIEW`, `PROVEN`, or `completed`
  without inspectable evidence.

The matrix is intentionally separate from live model-quality benchmarks. It
proves product contracts under controlled failures; it does not claim that a
provider will produce a correct repair.