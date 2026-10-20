---
name: Mission management browser proof
description: Browser proof for operator-managed Missions and Goals should isolate mutations and assert durable values.
---

Authenticated Mission/Goal journeys should use provider-free, in-browser API fixtures for create/update requests, include the Mission plan-preview confirmation gate, and exercise original-Chat return navigation through the dashboard base path before checking persistence after reload.

**Why:** This verifies the full operator path without mutating real project data, while catching mismatches between form controls, plan confirmation, projection refresh, and persisted-looking UI state. A create journey that skips preview cannot enable confirmation. A root-relative native anchor can also escape the deployed `/dashboard/` base and prevent the return flow from loading.

**How to apply:** Fixture `POST /api/ai/missions/plan-preview` and assert the exact `expectedPlanHash` on Mission creation. Use Wouter `Link` for internal route navigation and assert the dashboard-prefixed destination, original session/message IDs, active Mission selection, and persistence after reload. Match stable data-test IDs for controls and assert source values such as `active` or `verifying`; CSS text transforms are presentation only and should not define the browser contract. For rows with nested action buttons, scope the locator to the row toggle and allow its accessible name to change between expanded and collapsed states; a title-only regex can also match edit/delete controls.