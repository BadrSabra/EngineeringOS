---
name: World State advisory planning
description: Project rule for using World State facts in Mission re-planning.
---

World State facts are advisory context, not proof, permission, or authority. A changed fact may be bound into a replan revision and task prompt without changing deterministic plan steps. Do not add generic fact-to-action rules until a domain policy exists and that behavior is tested.

For Mission World State planning reads, select the acceptance ID carried by the Goal's durable outcome projection; never choose the latest row by timestamp or reject an execution solely because earlier attempts also have acceptances. Still require the selected acceptance to match the current execution attempt and the exact Episode/source revision, failing closed on stale or mismatched identity.

**Why:** revision and prompt binding show that the planner received current context; they do not establish that the selected action changed or that arbitrary facts imply a specific action.

**How to apply:** retain exact acceptance-ID, current-attempt, source-observation, Episode-scope, and revision checks; label the facts advisory; do not claim closed-loop decision change based only on context injection.