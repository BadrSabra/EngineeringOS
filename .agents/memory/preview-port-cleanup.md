---
name: Preview port cleanup
description: Port cleanup behavior needed by local preview workflows in this environment.
---

Preview workflow restart scripts should use the available `lsof` command rather than assuming `fuser` exists, and should wait for the old listener to disappear before starting a replacement.

**Why:** The runtime image does not provide `fuser`, and sending a termination signal without waiting creates a race where Vite can fail to bind during a rapid workflow restart.

**How to apply:** Scope process discovery to the exact TCP listening port, terminate only those PIDs, poll for release, and escalate only after a short grace period.

Release validation should spawn the final API server process directly after its build rather than relying on a package script that may orphan grandchildren; own both service process groups and await their exit in `finally`. Verify release ports are free before each run because a prior detached child can survive successful teardown.

**Why:** A detached package runner can leave the API listener alive after a successful browser journey, contaminating later isolated runs even when the parent command exits cleanly.

**How to apply:** Keep release service ports distinct from Project, start health checks only after both services are ready, and verify the release ports are closed after success or failure.

Application dev commands should not perform port ownership or PID cleanup. Workflow-owned smoke/restart checks must stop the child process they created, wait for the port to close, and then start the replacement.

**Why:** A dev command cannot safely distinguish a stale sibling workflow from an unrelated listener; self-cleanup caused shared-port races and could terminate the wrong process.

**How to apply:** Keep process-group teardown in the workflow/smoke harness, not in Vite's package `dev` script.