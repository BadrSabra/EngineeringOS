---
name: Shadow replay proof boundary
description: Durable scope and proof requirements for non-production candidate replay
---

Shadow Replay must be bound to the same project, Mission, Goal, source revision, candidate identity, and active plan revision as the accepted source candidate. Its terminal receipt must reference the Canonical Proof composed from the replay execution's own acceptance and evidence, not only the source candidate receipt.

**Why:** A disposable workspace and unchanged tree hash prove isolation and readback, but they do not prove that the replay followed the durable objective lifecycle or produced accepted evidence of its own.

**How to apply:** Reject replay when the Goal is missing, not completed, or stale against the Mission plan. Derive the replay behavior from the persisted `Goal.nextAction`; accept only the server-owned, side-effect-free verification recipe with an exact approved-path scope. Persist the replay execution with `goalId`, run the existing recipe/acceptance lifecycle, and fail closed unless replay-owned Canonical Proof is `PROVEN`. Gate 3 must execute registered benchmark cases and compare observed per-case telemetry; server-owned static checks are bounded evidence only and unsupported behavioral objectives remain incomplete.