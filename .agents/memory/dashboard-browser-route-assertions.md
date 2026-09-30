---
name: Dashboard browser route assertions
description: Authenticated Playwright route assertions differ from isolated component tests because the dashboard runs under its artifact base path.
---

Authenticated Dashboard browser journeys run under `/dashboard/`; their rendered links include that prefix, while isolated component tests may render root-relative hrefs. Prefer current accessible names and rendered identity selectors over stale labels when locating execution destinations.

**Why:** The router applies the artifact base path in the browser, and stale end-to-end selectors can prevent a new keyboard assertion from running at all.

**How to apply:** When adding Dashboard browser assertions, derive expected hrefs from the mounted artifact path and confirm selectors against the current rendered UI. Run the focused journey before the broader suite.