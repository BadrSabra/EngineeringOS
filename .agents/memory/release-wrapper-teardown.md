---
name: Release wrapper teardown
description: Release journey wrappers may pass assertions but end with SIGTERM/SIGHUP while terminating child dev servers.
---

Release validation must distinguish assertion results from wrapper/process teardown status. Dashboard E2E and restart smoke can report all checks passed while their child dev server exits with SIGTERM during cleanup; real process recovery can remain running until externally stopped and then surface SIGHUP.

**Why:** The release scripts spawn managed API and Dashboard child processes, while the surrounding workflow also owns those ports. A clean assertion run is not sufficient evidence of a clean top-level process exit.

**How to apply:** Report assertion counts and lifecycle status separately. Treat process-recovery hangs as blockers, and do not call a release workflow fully green until child cleanup and fixture retirement finish without external termination.