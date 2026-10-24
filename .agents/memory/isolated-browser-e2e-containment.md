---
name: Isolated browser E2E containment
description: Keep browser test listeners loopback-only and preserve artifacts in a unique run directory.
---

For isolated dashboard E2E runs, do not append `--host 127.0.0.1` after `--` to a package script that already hard-codes `--host 0.0.0.0`; Vite can still bind all interfaces. Invoke Vite in a way that lets the test-mode config own the host, and use an absolute Playwright output directory under the unique run folder.

**Why:** A real controlled run showed Vite's network-interface URL despite a later loopback flag, and failure screenshots/traces landed in the dashboard package's default `test-results` path instead of the unique run directory.

**How to apply:** Before launching the browser, verify the effective listener is `127.0.0.1`, confirm the resolved Playwright output path is inside the run folder, and block or locally stub external font requests rather than allowing outbound access.

The local auth fixture is enabled only in `NODE_ENV=test`; set that explicitly for the isolated E2E process tree. Never make the fixed test identity available in development or production.

**Why:** Inheriting `NODE_ENV=development` routed auth through the Clerk code path and failed pre-browser auth tests; the isolated test-mode run restored the fixed server identity and ownership checks.

**How to apply:** Set test mode only on the isolated test process tree, retain fixed server identity and project-ownership assertions, and leave managed app workflows unchanged.
