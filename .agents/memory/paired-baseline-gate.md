---
name: Paired baseline gate
description: Durable design rule for counterfactual baseline/candidate comparisons before promotion.
---

Gate 3 is a counterfactual comparison, not an aggregate scorecard check. Baseline and candidate must use the same server-owned source revision, objective, scope, budget, and case manifest while retaining distinct workspace and run identities. Promotion requires complete per-case evidence for coverage, validator outcome, call safety, recovery, resource use, and terminal outcome; missing or mismatched evidence fails closed.

**Why:** Aggregate metrics can hide a terminal-outcome change, an unauthorized call, or a missing evidence window in one case. The candidate must be compared against its paired witness before any promotion path can treat it as eligible. A route test blocked by an earlier filesystem, validation-profile, or scope guard does not prove the paired-baseline check.

**How to apply:** Keep the paired contract and comparison metadata-only and provider-independent. Let server-owned adapters supply workspace hashes and bounded telemetry; never let provider prose set paired metrics or the final status. Bind the baseline workspace to the persisted base-tree identity rather than a mutable project timestamp, then persist and project the comparison through the existing shadow-replay receipt before promotion. In route-level race tests, choose a change path and validator profile admitted by both validation scope and auto-promotion policy, then mutate the durable receipt only after the first eligibility decision so the apply-time recheck is exercised.