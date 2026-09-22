---
name: Mission management browser proof
description: Browser proof for operator-managed Missions and Goals should isolate mutations and assert durable values.
---

Authenticated Mission/Goal journeys should use provider-free, in-browser API fixtures for create/update requests, then reload the page and assert the durable values are still rendered.

**Why:** This verifies the full operator path without mutating real project data, while catching mismatches between form controls, projection refresh, and persisted-looking UI state.

**How to apply:** Match stable data-test IDs for controls and assert source values such as `active` or `verifying`; CSS text transforms are presentation only and should not define the browser contract.