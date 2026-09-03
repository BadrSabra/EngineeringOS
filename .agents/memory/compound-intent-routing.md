---
name: Compound intent routing
description: Durable routing rule for requests that combine evidence collection with a later change or validation phase.
---

Compound requests must preserve the named source as the first evidence target without inheriting a forensic read-only tool manifest for their later proposal or authorized validation phase.

**Why:** Single-file forensic detection is intentionally strict, but it is a classification heuristic. Applying it unchanged to “inspect then fix” hides the later pending-change tools even though server authorization still controls whether a change can be applied.

**How to apply:** Keep compound detection ordered and conservative: require a sequence marker followed by an action/validation verb, let server-owned approval and scope gates decide execution, and retain explicit read-only isolation directives as the stronger boundary.