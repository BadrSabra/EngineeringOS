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

Ordinary provider routing and direct completion remain deterministic unless
`AI_LIFECYCLE_LIVE_CHECKS=1` or `RUN_CONTROLLED_RELEASE_VALIDATION=1` is set;
the lifecycle service still records confirmed runtime outcomes.

**Why:** Fixture suites and normal development must not make network probes, while
explicit release/live runs must enforce credential, model, catalog, and capability
gates before accepting a provider.

**How to apply:** Keep live-check flags opt-in at route and completion boundaries;
preserve provider-neutral lifecycle projections even when an unchecked provider is
shown as degraded/not verified.

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

Bounded capability-probe recovery should request a powerful JSON-capable model
chain, retry only one candidate after the first bounded chain, and suppress
request-local recovery failures from the global provider circuit.

**Why:** Live free-tier runs can partially succeed, then exhaust several model
timeouts while correcting one missing capability; replaying the full chain
inflates latency and can falsely mark a healthy provider circuit as unavailable.

**How to apply:** Keep the recovery deadline and final-output reserve unchanged;
use provider-owned fallback only for the first attempt, keep retries single-model,
and retain fail-closed `ANALYSIS_INCOMPLETE` when evidence remains unaccepted.