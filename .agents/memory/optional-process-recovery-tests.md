---
name: Optional process recovery tests
description: Environment-specific guidance for opt-in API child-process recovery tests.
---

Opt-in child-process integration tests must resolve the built API entrypoint from the package working directory, not from the workspace root.

**Why:** Package-scoped test commands change the child process working directory; a workspace-relative path can make the server exit before the test reaches its recovery assertions.

**How to apply:** Build the API in the current package context and use an absolute path derived from `process.cwd()` when spawning the server. Keep the test gated so ordinary suites remain deterministic.