---
name: Non-root network isolation
description: Safe local lifecycle E2E requires both an isolated loopback-only network namespace and a non-root test runner.
---

Do not run the lifecycle E2E as root inside a user-mapped network namespace merely to bring up loopback. The runner and PostgreSQL require a non-root identity; an ordinary unprivileged user namespace in this workspace cannot raise `lo`, while automatic subordinate-ID mapping requires a usable `newuidmap` helper. In Docker `--network none`, a default route whose only interface is `lo` can still appear in the IPv6 route table; this is not an egress path when the namespace has no other interface. Accept only loopback interfaces and routes, including an `lo`-scoped default; reject every non-loopback interface/route and missing route evidence.

**Why:** In the Replit workspace, the root-mapped namespace could configure loopback but violated the runner's non-root contract; mapping the current UID preserved non-root execution but lacked `CAP_NET_ADMIN`. The available `newuidmap` binary had no privileged wrapper, so automatic mapping failed closed. GitHub's `--network none` container also showed IPv6 default entries on `lo`, and disabling IPv6 did not remove them; rejecting every default route caused a false failure before checkout despite a distinct namespace and no external interface.

**How to apply:** Before a lifecycle browser run, verify a non-root runner, a distinct namespace, only `lo`, and complete route evidence with every route bound to `lo`. Keep Docker runtime on `--network none`; reject all non-loopback routes/interfaces and do not weaken authentication or PostgreSQL guards. If those conditions cannot be proven, report `BLOCKED_BEFORE_BROWSER`.
