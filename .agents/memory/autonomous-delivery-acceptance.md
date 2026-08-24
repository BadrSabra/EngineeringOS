---
name: Autonomous delivery acceptance
description: The measurement boundary for unified operation-loop campaigns and verified delivery outcomes.
---

Acceptance accounting is read-only and consumes one bounded receipt per unique operation. Terminal outcome, recovery, scope violation, and repeated side effect are separate dimensions; a model or HTTP success is not delivery proof.

**Why:** Source-level endpoint success cannot establish autonomous delivery reliability, and collapsing blocked or unverifiable runs into failures hides the safety behavior being measured.

**How to apply:** Keep deterministic fixtures as the default campaign. Enable provider, browser, deployment, and remote-delivery lanes explicitly, with isolated workspaces and redacted receipts. Count completion only when candidate delivery is verified and no scope or repeated-side-effect violation occurred.