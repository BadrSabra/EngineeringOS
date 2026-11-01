---
name: Non-root network isolation
description: Safe local lifecycle E2E requires both an isolated loopback-only network namespace and a non-root test runner.
---

Do not run the lifecycle E2E as root inside a user-mapped network namespace merely to bring up loopback. The runner and PostgreSQL require a non-root identity; an ordinary unprivileged user namespace in this workspace cannot raise `lo`, while automatic subordinate-ID mapping requires a usable `newuidmap` helper.

**Why:** In the Replit workspace, the root-mapped namespace could configure loopback but violated the runner's non-root contract; mapping the current UID preserved non-root execution but lacked `CAP_NET_ADMIN`. The available `newuidmap` binary had no privileged wrapper, so automatic mapping failed closed.

**How to apply:** Before a lifecycle browser run, verify that the runner is non-root and its network namespace is distinct, loopback-only, and route-free. If the environment cannot satisfy both, report `BLOCKED_BEFORE_BROWSER`; do not weaken authentication, PostgreSQL, or egress guards.
