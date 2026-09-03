---
name: Compound intent routing
description: Durable routing rule for requests that combine evidence collection with a later change or validation phase.
---

Compound requests must preserve the named source as the first evidence target without inheriting a forensic read-only tool manifest for their later proposal or authorized validation phase. An inspect → fix turn may create a pending proposal only after a source read is observed; a direct compound request without prior plan metadata must not be routed through the recovered-plan handoff gate, and a proposal-phase batch must not execute gathering calls after its edit.

**Why:** Single-file forensic detection is intentionally strict, but it is a classification heuristic. Applying it unchanged to “inspect then fix” hides the later pending-change tools even though server authorization still controls whether a change can be applied.

**How to apply:** Keep compound detection ordered and conservative: require a sequence marker followed by an action/validation verb, require a successful source-read trace before creating a compound proposal, use a safe default validation profile when no plan supplies one, let server-owned approval and scope gates decide execution, and retain explicit read-only isolation directives as the stronger boundary.