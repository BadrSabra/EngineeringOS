---
name: World State advisory planning
description: Project rule for using World State facts in Mission re-planning.
---

World State facts are advisory context, not proof, permission, or authority. A changed fact may be bound into a replan revision and task prompt without changing deterministic plan steps. Do not add generic fact-to-action rules until a domain policy exists and that behavior is tested.

**Why:** revision and prompt binding show that the planner received current context; they do not establish that the selected action changed or that arbitrary facts imply a specific action.

**How to apply:** retain exact source-observation, scope, and revision checks; label the facts advisory; do not claim closed-loop decision change based only on context injection.