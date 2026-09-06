---
name: Dashboard authenticated smoke
description: The release browser proof must preserve the Clerk session's dashboard-origin cookie path while keeping provider-free API fixtures deterministic.
---

The protected dashboard smoke should send its real authenticated API probe through the dashboard origin and configured API proxy, not directly through a separate local API origin. Direct local requests can omit the handoff cookie and produce a misleading 401 even after a successful Clerk navigation.

**Why:** The release runner serves the dashboard and API on different local ports while the Clerk handoff session is established on the dashboard origin. The browser's normal relative API request follows the proxy and carries the session correctly.

**How to apply:** Keep the page-level data fixture in place, allow only an explicit probe request to continue to the real API, and treat the provider-free 428 AI fixture response as the sole documented console-error exception.