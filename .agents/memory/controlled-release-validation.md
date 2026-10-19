---
name: Controlled release validation
description: How live provider-backed recovery validation is separated from ordinary release configuration tests.
---

Provider-backed process-recovery validation must remain an explicit opt-in command; ordinary configuration tests must continue to clear provider and database configuration so they never make live calls.

**Why:** The recovery test starts a real API child process and can spend significant time against an external provider, while configuration regressions need deterministic failure-path coverage.

**How to apply:** Use the controlled release command only in an environment with the required provider and database configuration. For OpenRouter live recovery, set `OPENROUTER_MODEL` to a paid tool-capable model when the free catalog is unavailable. Keep the normal scripts test suite provider-free and assert that the deployment chain still propagates recovery failures.

The dashboard release journey may use a provider-free Groq catalog fixture guarded by
`RUN_CONTROLLED_RELEASE_VALIDATION=1`; its local control surface should change only
bounded catalog states and the browser evidence should read the real authenticated
alert endpoint.

**Why:** Catalog outage and retired-model drift are operator-visible persistence
contracts that need real process restarts, but release checks must not depend on
provider credentials or expose provider diagnostics.

**How to apply:** Keep timeout, healthy, and retired states explicit; deduplicate
repeated outage observations, resolve them on healthy startup, and retain a
redacted evidence receipt linked from release teardown.

The guarded Groq catalog fixture must be validated even when runtime provider
routing omits Groq. Add Groq only to the fixture's validation pass; do not widen
the application's provider routing or require a real provider credential.

**Why:** Product routing can intentionally remain OpenRouter-only while the
release journey still needs to verify Groq outage and model-drift alert
persistence without provider egress.

**How to apply:** Keep this exception behind the controlled-release fixture
guards, and test it with the normal runtime provider priority and no Groq key.

Ordinary provider routing and direct completion remain deterministic unless
`AI_LIFECYCLE_LIVE_CHECKS=1` or `RUN_CONTROLLED_RELEASE_VALIDATION=1` is set;
the lifecycle service still records confirmed runtime outcomes.

**Why:** Fixture suites and normal development must not make network probes, while
explicit release/live runs must enforce credential, model, catalog, and capability
gates before accepting a provider.

**How to apply:** Keep live-check flags opt-in at route and completion boundaries;
preserve provider-neutral lifecycle projections even when an unchecked provider is
shown as degraded/not verified.

The standalone live structured-review campaign is an isolated direct `reviewCode`
call, not the embedded API/session path; it must not be treated as proof of
dashboard persistence, SSE recovery, or durable execution behavior.

**Why:** The campaign creates its own disposable fixture and operation receipt,
while the production review route applies project rate limiting, provider
lifecycle selection, telemetry, and structured-failure persistence before
calling the agent. A passing or failing campaign can otherwise be attributed to
the wrong execution boundary.

**How to apply:** Trace the embedded route separately, or make the campaign use
the same execution adapter and preflight boundary before drawing conclusions
about user-facing agent behavior.

The release quality gate must remove the controlled marker from provider-free
contract-test children and add it only to preview or explicitly live-provider
checks. Concurrency fixtures that assert submission order must establish a
request-owned readiness barrier before launching the second request.

**Why:** A blanket controlled marker makes mocked route suites perform real
credential/catalog checks, while unconstrained concurrent test startup can invert
durable turn timestamps and create intermittent release failures.

**How to apply:** Classify release checks by execution boundary when building
child environments; use bounded fixture barriers when the assertion depends on
which concurrent turn was submitted first.

Free OpenRouter catalog models are not a reliable positive receipt source for the
live capability probe: some reach read tools but emit malformed structured output,
while the shared fast recovery model can time out and open the circuit; a stable
tool-capable provider/model is required for accepted C1–C7 evidence.

**Why:** A live probe can therefore prove provider reachability, real reads, and
fail-closed recovery without proving positive evidence acceptance; treating those
as equivalent would create a false release signal.

**How to apply:** Keep the live probe opt-in and disposable, preserve the
`ANALYSIS_INCOMPLETE` receipt, and rerun only after an approved provider/model with
reliable JSON and recovery latency is configured. Never infer positive acceptance
from complete source reads or partial micro-probe labels; require durable
`acceptedEvidenceCount` and `acceptedClaimCount` values.

Live free-model project queries can complete scoped reads and still return no
usable synthesis; a rate-limited alternate free model is a provider constraint,
not evidence of an application defect.

**Why:** A direct multi-file query retained both requested sources but closed no
behavioral claim, while a more capable free candidate was rate-limited before
completion. The server correctly remained incomplete rather than inventing an
answer.

**How to apply:** Keep these outcomes as incomplete live observations, preserve
the evidence-acceptance boundary, and do not change application behavior to make
an unaccepted provider response appear successful.

Bounded capability-probe recovery should request a powerful JSON-capable model
chain, retry only one candidate after the first bounded chain, and suppress
request-local recovery failures from the global provider circuit.

**Why:** Live free-tier runs can partially succeed, then exhaust several model
timeouts while correcting one missing capability; replaying the full chain
inflates latency and can falsely mark a healthy provider circuit as unavailable.

**How to apply:** Keep the recovery deadline and final-output reserve unchanged;
use provider-owned fallback only for the first attempt, keep retries single-model,
and retain fail-closed `ANALYSIS_INCOMPLETE` when evidence remains unaccepted.

Before running required process recovery, verify that `DATABASE_URL` targets a
disposable database and set `LIVE_RECOVERY_RECEIPT_PATH` to an isolated output.
`RELEASE_PROCESS_RECOVERY_REQUIRED=1` only turns a skipped recovery into a
failure; it does not enable the real run. Set
`RUN_REAL_API_PROCESS_RECOVERY=1` only in that controlled environment: the
harness uses the configured database/provider and atomically replaces the
selected receipt on success.

**Why:** The required flag is a release gate, not the process-recovery opt-in.
The real harness uses persistent database/provider configuration and replaces
its selected receipt, so an ordinary development environment may not be safe.

**How to apply:** Before starting the release workflow, establish that the
database is disposable, the provider run is explicitly authorized, and receipt
output is isolated. Do not run real process recovery when any of those boundaries
is uncertain.

Provider-free HTTP restart tests may run `src/app.ts` for route/history
persistence. A test may start `src/index.ts` only in a dedicated child with a
loopback-only disposable database, an ephemeral loopback port, no provider
credentials in its environment, and the complete egress-disable guard:
`AI_PROVIDER_EGRESS_DISABLED=1`, `RUN_CONTROLLED_RELEASE_VALIDATION=1`, and
`DASHBOARD_E2E_TEST_MODE=fixture`. Confirm `isProviderEgressDisabled()` before
importing the operational entrypoint; never replace or restart a Replit-managed
workflow for this test.

**Why:** The operational entrypoint starts provider/catalog validation and
durable recovery workers, and startup reconciliation pauses every running
execution it finds. An egress guard blocks provider calls but does not make
startup side effects harmless. A managed API workflow can also fail with
`EADDRINUSE` while another listener owns its default port; matching command
lines alone do not establish that a process is test-owned.

**How to apply:** Keep the `src/app.ts` test for isolated HTTP persistence and use
the guarded `src/index.ts` child only when startup reconciliation is part of the
acceptance boundary. On port conflicts, inspect workflow and process ownership
read-only; never terminate a process group based only on its API command line.
Never replace or restart a managed workflow for this test. Stop the test
PostgreSQL process and remove only its dedicated temporary data root after
verification; state explicitly that managed workflows and live providers were
not exercised.

Operational API children must also receive a per-run temporary `WORKSPACE_PATH`,
and fixture projects should use that same root. Startup's `ensureEncryptionKey`
persists `.local/encryption.key` under this path when no key is configured.

**Why:** A process-recovery attempt using the API package root created a
persistent ignored encryption-key file before the test reached its assertions.
Database isolation alone does not isolate filesystem side effects.

**How to apply:** Keep the temporary workspace until every API child has exited,
then remove only that test-owned root. Do not inspect or delete a key created in
the shared workspace; use a temporary root to prevent recurrence instead.

Ordinary API Vitest suites should keep controlled live-provider lifecycle checks
off and block outbound `fetch` in test setup while permitting loopback fixtures.
Do not set the application-level provider egress flag for mocked contract tests.

**Why:** The application guard rejects before mocked transport and lifecycle
fixtures run, changing the behavior under test. A test-only fetch boundary blocks
actual external requests without bypassing those fixtures.

**How to apply:** Use the API Vitest network guard for contract suites; reserve
the complete application egress-disable flags for controlled preview or startup
tests that exercise those specific guards.

## Live process-recovery sequencing

Start the first forensic execution through the chat-stream route without an
execution ID or resume token, then capture both from `execution_started`.
Pre-creating a queued execution and submitting its token is not a valid initial
claim. After killing the worker, expire only that row's lease in the disposable
database before starting the recovery process; production leases last five
minutes. Startup dispatch may automatically claim the recovered execution
before an HTTP resume arrives, so verify the durable result rather than racing
the dispatcher with a duplicate resume request.

**Why:** `claimAiExecution` accepts a resume token only for paused/failed
attempts, and startup reconciliation only expires dead workers after their
lease. The operational dispatcher may then own the new attempt before the test
client can claim it.

**How to apply:** Keep this choreography inside the opt-in recovery harness,
using a loopback disposable database and an isolated receipt. Never shorten the
production lease or change the managed API workflow to make this test pass.