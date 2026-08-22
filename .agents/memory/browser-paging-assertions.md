---
name: Browser paging assertions
description: Reliable Playwright checks for paginated React Query views
---

When browser tests navigate back to a previously loaded page, assert the visible page state rather than requiring a second network request.

**Why:** React Query may serve the earlier page from cache, so a request-based wait can time out even though the user-visible page changed correctly.

**How to apply:** Wait for the page indicator and distinctive row content after navigation; inspect request parameters on the transitions that must fetch a new page.