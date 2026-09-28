---
name: Dashboard Chromium SIGBUS
description: Browser-runtime failure and safe cleanup boundary for controlled Dashboard journeys.
---

Several controlled real-Clerk Dashboard journeys in this Replit environment used
the managed Nix Chromium 138 executable and terminated the browser process with
`SIGBUS` during reload/navigation. Playwright recorded page close and browser
disconnect; browser stderr also showed a GPU process exit. Upload, scan, plugin
activation, and profile create/edit requests had completed before the crash.
There was no app navigation/network error immediately before the target vanished.
Memory and `/tmp` capacity were available; kernel logs were not readable.
`--disable-gpu` and `--disable-dev-shm-usage` were already set, and an added
SwiftShader flag did not resolve the crash.

Playwright-managed Chromium and its headless shell also reproduced `BUS_ADRERR`
in this environment. The same authenticated profile CRUD journey passed under
Playwright Firefox when run through the external Replit development origin, with
the full create, edit, and delete reload assertions intact. A saved-state
APIRequestContext returned 401 when tied to a localhost origin, but succeeded
when tied to the external origin that issued the Clerk session.

**Why:** Repeatedly increasing Playwright timeouts or changing reload semantics
can mask a browser-runtime failure rather than fix an application defect. A
different browser engine can still provide valid persistence evidence. Playwright
selects the engine from `browserName`; setting only an executable path does not
switch a Chromium project to Firefox.

**How to apply:** Capture browser-process stderr plus page/browser lifecycle
events before changing navigation assertions. If Chromium and its bundled
headless shell fail, install Playwright Firefox and select it explicitly with
`DASHBOARD_E2E_BROWSER=firefox`; use the external Replit development origin for
both dashboard and API requests, and keep every reload assertion. Keep any
independent APIRequestContext on the same origin as the Clerk session; verify
its auth before depending on it for cleanup. If the browser is gone, verify the
exact project ID and owner, then use the normal owner-scoped API delete so server
safeguards remove the row and root. Avoid broad SQL or filesystem deletion.