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

**Why:** Repeatedly increasing Playwright timeouts or changing reload semantics
can mask a browser-runtime failure rather than fix an application defect.

**How to apply:** Capture browser-process stderr plus page/browser lifecycle
events before changing navigation assertions. Test cleanup that depends only on
`page.evaluate` cannot reach the API after Chromium exits. For failed-run cleanup,
verify the exact project ID, owner, name, and managed root, then use the normal
owner-scoped API delete so server safeguards remove the row and root. Avoid broad
SQL or filesystem deletion. An independent API request context with saved auth
state may improve cleanup, but verify it under the failing runner before relying
on it.