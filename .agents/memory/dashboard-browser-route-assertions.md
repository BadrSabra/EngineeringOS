---
name: Dashboard browser route assertions
description: Authenticated Playwright route assertions differ from isolated component tests because the dashboard runs under its artifact base path.
---

Authenticated Dashboard browser journeys run under `/dashboard/`; their rendered links include that prefix, while isolated component tests may render root-relative hrefs. Prefer current accessible names and rendered identity selectors over stale labels when locating execution destinations.

**Why:** The router applies the artifact base path in the browser, and stale end-to-end selectors can prevent a new keyboard assertion from running at all.

**How to apply:** When adding Dashboard browser assertions, derive expected hrefs from the mounted artifact path and confirm selectors against the current rendered UI. Run the focused journey before the broader suite.

For Firefox reload assertions, use `page.reload({ waitUntil: "domcontentloaded" })` when the UI renders but waiting for the full `load` event stalls; follow it with assertions on the persisted UI state.

**Why:** A multi-route Firefox journey showed the Flight Deck proof fully rendered in the failure screenshot, while `page.reload()` still waited for `load` until the test timed out.

**How to apply:** Prefer the DOM-content milestone for reload persistence checks, then let accessible UI assertions verify that data has reloaded. Keep full-load waits only when the test specifically depends on all page resources completing.

For Clerk-backed Firefox journeys, use `page.goto(path, { waitUntil: "domcontentloaded" })` for the initial signed-out dashboard navigation, then wait for the sign-in controls and authenticated dashboard readiness.

**Why:** The release journey stalled at the initial navigation while external Clerk scripts were still loading; DOM-ready navigation plus UI readiness assertions passed the protected-dashboard and isolated-user checks.

**How to apply:** Use a DOM-content milestone for initial Clerk handoffs and reloads, keep browser-error assertions after authentication, and reserve full-load waits for tests that explicitly require every external resource to finish.