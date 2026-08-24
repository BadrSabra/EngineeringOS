# Critical Runtime Coverage Matrix

This matrix records the provider-free regression coverage for the runtime
surfaces that can otherwise produce a false success or strand recoverable work.
It complements the observable-agent gap register; live providers, deployment,
remote push, and long-horizon browser campaigns remain explicitly opt-in.

| Risk / gap | Deterministic coverage | Safety assertion |
|---|---|---|
| AI provider absence, provider error, malformed output | `routes/ai.test.ts` task/chat/analyze/review/workflow cases | 428/typed provider errors and 422 parse errors do not leave tasks running or persist raw diagnostics |
| Duplicate task submission and stale worker completion | `routes/ai.test.ts`, `lib/task-execution-service.test.ts`, `lib/ai-execution-state.test.ts` | one owner wins; late completion cannot overwrite a newer state |
| Cancellation, restart, retry exhaustion | `lib/job-reconciliation.test.ts`, `lib/operational-readiness-gate.test.ts`, AI route lifecycle cases | cancellation/restart/failed recovery remains incomplete or failed, never proven |
| Candidate, revision, evidence, and redaction boundaries | `lib/operational-readiness-gate.test.ts`, `lib/operation-evidence.test.ts`, `routes/ai.test.ts` | mismatched candidate/revision or incomplete evidence blocks readiness; exported fields are redacted |
| Project ownership and cross-project rule evaluation | `routes/projects.test.ts`, `routes/events.test.ts`, `routes/rules.test.ts` | foreign projects are denied and scoped rules cannot be evaluated against another project |
| Audit/event linkage | `routes/ai.test.ts`, `routes/rules.test.ts`, `routes/workflows.test.ts`, `lib/audit.integration.test.ts` | state-changing operations retain correlation and before/after evidence |
| Browser reload, reconnect, stream EOF/abort, stale callbacks | `dashboard/src/pages/AiChat.authenticated.test.tsx`, `dashboard/src/lib/validation-sse-contract.test.ts`, dashboard journey contracts | rendered saved state is asserted after reload/reconnect; stale callbacks cannot claim completion |
| Release isolation and provider-free default | `scripts/dashboard-journey-contract.test.mjs`, release validation contracts | live campaigns require explicit opt-in and disposable targets |

## Deterministic exclusions and remaining combinations

The following are intentionally not claimed as closed by this suite:

* live provider quality, provider outage behavior outside typed fixtures, and
  successful external delivery;
* production deployment behavior and cross-process browser convergence;
* every interleaving of cancellation with promotion, audit export, and process
  termination;
* exhaustive browser tab races and repository freshness over long-running jobs.

These exclusions are conservative: their current readiness paths require
matching ownership, operation, candidate/revision, passed checks, retained
evidence, and a terminal `PROVEN` verdict. Missing or partial proof therefore
cannot silently become a proven-success result.