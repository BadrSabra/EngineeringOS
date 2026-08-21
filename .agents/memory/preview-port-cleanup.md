---
name: Preview port cleanup
description: Port cleanup behavior needed by local preview workflows in this environment.
---

Preview workflow restart scripts should use the available `lsof` command rather than assuming `fuser` exists, and should wait for the old listener to disappear before starting a replacement.

**Why:** The runtime image does not provide `fuser`, and sending a termination signal without waiting creates a race where Vite can fail to bind during a rapid workflow restart.

**How to apply:** Scope process discovery to the exact TCP listening port, terminate only those PIDs, poll for release, and escalate only after a short grace period.

Release validation should spawn the final API server process directly after its build rather than relying on a package script that may orphan grandchildren; own both service process groups and await their exit in `finally`.

**Why:** A detached package runner can leave the API listener alive after a successful browser journey, contaminating later isolated runs even when the parent command exits cleanly.

**How to apply:** Keep release service ports distinct from Project, start health checks only after both services are ready, and verify the release ports are closed after success or failure.