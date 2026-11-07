---
name: Concurrent preview port allocation
description: Prevent independent runtime starts from selecting the same managed listener port.
---

The runtime supervisor must serialize the check-and-reserve step for its shared preview-port pool and retain each in-memory reservation until the child binds or startup cleanup completes. Project-scoped database locks do not protect this global resource.

**Why:** Parallel project starts selected the same free port before either child bound it. The second startup then observed the first project's listener and could report a false-ready preview with the wrong response.

**How to apply:** When changing preview startup or readiness checks, test with distinct project roots and hold child listeners behind a gate until both assigned ports are observable; assert distinct ports, exact process-group roots, and project-specific responses.
