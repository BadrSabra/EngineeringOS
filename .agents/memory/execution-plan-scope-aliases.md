---
name: Execution-plan scope aliases
description: The route and agent use TurnIntent task labels that do not all match legacy task-profile scope strings.
---

Normalize semantic task labels such as analysis, task_execution, code_review, workflow, and tool_chat before task-profile inference.

**Why:** The existing profile builder recognizes descriptive scopes such as scan-runner and task-runner. Passing the newer TurnIntent labels through unchanged silently downgrades them to ordinary tool chat, causing context, history, memory, and prompt policy drift.

**How to apply:** Keep the original scope available at compatibility boundaries and normalize inside the authoritative execution-plan resolver. Resolve the plan once at the route, then pass it through all downstream context and agent calls.