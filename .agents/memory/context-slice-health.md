---
name: Context slice health
description: Context availability must remain distinct from freshness so empty and failed reads cannot become project facts.
---

Keep load outcome separate from age and admission state: `not_requested`, `empty`, `loaded`, and `load_failed` are different facts, and failed reads must carry only a bounded category.

**Why:** An empty fallback after a database error can make the model treat missing telemetry or graph data as proof that the project has none.

**How to apply:** Preserve the health state through loading, serialization, caching, prompt metadata, lifetime demotion, and snapshot diffs; do not cache a failed read as if it were a valid empty context.