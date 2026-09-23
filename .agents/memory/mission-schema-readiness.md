---
name: Mission schema readiness
description: Startup reconciliation depends on the durable Mission and Goal schema being present in the development database.
---

The API's durable reconciliation and mission workers query Mission/Goal tables during startup and periodic dispatch. A successful build is not enough: the development database must pass the application's schema checks before those workers can run reliably.

**Why:** A stale development schema caused startup reconciliation to fail on missing Mission/Goal relations and columns even though the API bundle built successfully.

**How to apply:** Before runtime or release validation, apply the project's development schema flow and verify the schema/readiness endpoints before diagnosing mission execution behavior.