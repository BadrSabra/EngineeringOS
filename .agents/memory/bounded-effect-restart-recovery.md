---
name: Bounded effect restart recovery
description: How the file-marker restart proof is built and two production contracts it exposed (observation roles, same-attempt pause snapshot).
---
- The restart proof uses a test-only executor injected through the existing `runGoal` seam. Like production it only creates the execution and returns "scheduled"; work runs afterwards, so crashes follow a recorded dispatch. A child process running the production recovery modules (expired-lease reconcile, stale-task reconcile, dispatch reconcile, outcome reconcile) stands in for the API process; it is not the full `src/index.ts`.
- Same-attempt recovery must reuse the recorded before observation; rotating the attempt would make "before" already show the mutated state.
- Effect pairs must carry explicit `observationRole` before/after. The outcome evaluator accepts only those roles; the materializer used to store the predicate, which hid the gap behind fixtures that inserted roles directly.
- Reaching ACHIEVED also needs the Episode started with the project's current `worldRevision`; otherwise the evaluator reports `execution_proof_binding_missing`.
- A lease-expiry pause acceptance already owns the (execution, attempt) evidence snapshot; finalizing the replacement must supersede it in place, not insert a second one.
**Why:** each of these silently blocked a real restarted execution from being accepted or evaluated.
**How to apply:** when writing restart/recovery proofs, assert through real materializers and finalization, not hand-inserted rows. Dispatch recording requires an active Mission, so a synchronous executor that completes the Mission before dispatch is recorded never gets a DISPATCHED event (documented, not fixed).
