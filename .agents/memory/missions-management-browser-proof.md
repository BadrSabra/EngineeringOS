---
name: Mission management browser proof
description: Browser proof for operator-managed Missions and Goals should isolate mutations and assert durable values.
---

Authenticated Mission/Goal journeys should use provider-free, in-browser API fixtures for create/update requests, include the Mission plan-preview confirmation gate, and exercise original-Chat return navigation through the dashboard base path before checking persistence after reload.

**Why:** This verifies the full operator path without mutating real project data, while catching mismatches between form controls, plan confirmation, projection refresh, and persisted-looking UI state. A create journey that skips preview cannot enable confirmation. A root-relative native anchor can also escape the deployed `/dashboard/` base and prevent the return flow from loading.

**How to apply:** Fixture `POST /api/ai/missions/plan-preview` and assert the exact `expectedPlanHash` on Mission creation. Use Wouter `Link` for internal route navigation and assert the dashboard-prefixed destination, original session/message IDs, active Mission selection, and persistence after reload. Match stable data-test IDs for controls and assert source values such as `active` or `verifying`; CSS text transforms are presentation only and should not define the browser contract. For rows with nested action buttons, scope the locator to the row toggle and allow its accessible name to change between expanded and collapsed states; a title-only regex can also match edit/delete controls.

Mission selection after returning from a handoff must reconcile the visible session list with the successful server response; patching one cache entry alone can leave a stale “no active Mission” state.

**Why:** An authenticated browser journey received a successful selection response while the session list still rendered its prior null selection; mocked unit tests did not expose the stale view.

**How to apply:** After route-driven or manual selection, update the visible session state and revalidate the session-scoped list. Browser-test the active Mission card after return and after reload.