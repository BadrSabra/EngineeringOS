---
name: Live campaign isolation
description: Safety boundaries for empirical provider, browser, deployment, and remote-delivery campaigns.
---

Live campaigns are measurement-only: they require explicit opt-in, disposable workspaces and outputs, bounded execution, and redacted operation-keyed receipts. External unavailability is uncertainty, not a quality failure.

**Why:** Provider and side-effect lanes are useful for empirical evidence but must never overwrite release artifacts, mutate production execution paths, or become a required deterministic gate.

**How to apply:** Keep deterministic release checks provider-free. Require each live lane and any deployment or remote-delivery side effect to be independently enabled and reviewable.

Disposable source copies must exclude generated validation/project roots and dependency/build caches at every directory depth.

**Why:** Retained validation workspaces can exhaust process, port, or filesystem quotas before a campaign reaches provider execution, making the evidence incomplete.

**How to apply:** Treat generated workspace trees as non-source inputs in every recursive candidate copy; never delete shared evidence just to make a campaign fit.

Structured-review live receipts may retain only allowlisted provider/error/model identifiers and a bounded hash for a finding cited to the selected file; they must not retain model text, prompts, raw provider messages, or source bodies.

**Why:** A live provider response can contain credentials, paths, or untrusted instructions even when the campaign itself is disposable.

**How to apply:** Build receipts at the review-result boundary and make incomplete outcomes carry zero evidence; keep raw diagnostics in transient server logs only.

Provider campaigns blocked by server-owned preflight must persist a bounded run receipt before rethrowing the failure, with no invented case outcomes and an explicitly incomplete campaign status.

**Why:** A fail-closed process exit without a durable receipt makes the reason for a stopped campaign impossible to review or feed into release gating.

**How to apply:** Persist only allowlisted preflight identifiers, commands, and failure codes; keep provider probing and case execution after the preflight boundary.