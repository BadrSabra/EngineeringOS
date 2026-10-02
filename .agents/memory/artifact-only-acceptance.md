---
name: Artifact-only acceptance
description: Delivery executions can satisfy the proof contract with server-owned validation evidence without source-file reads.
---

The acceptance contract and source-read requirement are separate signals. A source-free artifact-only execution can satisfy proof with a non-empty, persisted evidence-artifact snapshot; its receipt or capability output alone is not proof. For recipes, artifacts must cover every passed receipt node and bind to the recipe/version, current execution attempt, durable operation, revision, and candidate identity when present. Forensic and source-analysis executions still require complete retained reads.

**Why:** Requiring source reads for every proof-required execution rejected valid Plan → Build handoffs, while accepting receipts alone would bypass the current-attempt evidence and identity checks required by Canonical Proof.

**How to apply:** Preserve `required` for the durable proof contract, and set source-evidence requirements independently when finalizing acceptance. Never weaken operation, node, revision, attempt, candidate, or validation-evidence checks. `sourceEvidenceRequired=false` does not make proof optional: artifact-only acceptance needs explicit `PROVEN` plus non-empty artifacts. Successful executions with `evidenceRequired=false` are `NOT_REQUIRED` and cannot serve as Canonical Proof.