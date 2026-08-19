---
name: Preview port cleanup
description: Port cleanup behavior needed by local preview workflows in this environment.
---

Preview workflow restart scripts should use the available `lsof` command rather than assuming `fuser` exists, and should wait for the old listener to disappear before starting a replacement.

**Why:** The runtime image does not provide `fuser`, and sending a termination signal without waiting creates a race where Vite can fail to bind during a rapid workflow restart.

**How to apply:** Scope process discovery to the exact TCP listening port, terminate only those PIDs, poll for release, and escalate only after a short grace period.