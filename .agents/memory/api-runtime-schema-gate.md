---
name: API runtime schema gate
description: Environment constraint affecting API startup and integration validation
---

The API artifact can compile and bundle successfully while refusing to start, or while integration fixtures fail during request setup, when the database schema is behind the current Drizzle definitions.

**Why:** The server performs fail-fast schema checks and the integration suite creates durable execution rows before reaching route behavior, so missing tables or columns mask application-level regressions.

**How to apply:** Treat missing-schema errors as a validation prerequisite and do not apply migrations as part of an unrelated feature task without explicit scope and consent.