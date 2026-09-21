---
name: Orientation proof compatibility
description: The acceptance contract needed when project orientation is also marked proof-required
---

When a project-orientation turn is marked proof-required, its server-owned proof is complete role coverage plus complete retained source reads. It must not be accepted or rejected only through the targeted project-query claim contract or an unrelated autonomous-operation evidence shape. Durable orientation manifests must also satisfy the same parser bounds as the planner output; otherwise the request becomes unparsable before terminal acceptance.

**Why:** A real orientation run can record complete role coverage and a verified answer while generic evidence telemetry still reports zero accepted claims. If the terminal path does not select an orientation-specific acceptance branch, the durable result can become `EXECUTION_ACCEPTANCE_INCOMPLETE` after the answer is already proven. In addition, a planner manifest with more paths per role than the durable request parser accepts makes `parseExecutionRequest` return undefined; a proof-required completion then fails the missing-revision guard even when objective validation and source evidence are valid.

**How to apply:** Keep orientation coverage, retained-read provenance, and terminal acceptance in one explicit branch. Keep planner, persistence, and parser cardinality limits aligned, with the writer validating the manifest through the same parser before durable mutation. Persist a structured rejection reason when that branch is not eligible; do not collapse all acceptance failures into the generic incomplete message. Malformed acceptance checks seen only in old checkpoints should remain fail-closed unless a current writer can produce them.