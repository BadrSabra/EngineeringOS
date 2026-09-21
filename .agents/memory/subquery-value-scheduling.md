---
name: Sub-query value scheduling
description: Decomposed project queries use server-owned value ordering and dependency gates
---

Sub-queries must not run in planner or alphabetical order by default. Classify them into acceptance gate, evidence producer, provider adapter, test counterevidence, or general; rank by expected proof value, objective proximity, gap likelihood, and bounded read cost. Acceptance gates precede producers, producers precede adapters, and tests follow the executable path. Dependent work is skipped when the prerequisite has no retained read evidence.

**Why:** Parallel broad reads duplicate files and can spend the budget on low-value sources before discovering that the objective cannot be proven.

**How to apply:** Keep this as the single scheduling layer between query planning and hierarchical execution. Preserve original task indexes for dependencies, narrow role-specific paths without dropping required objective paths, and let unrelated general queries share a wave.