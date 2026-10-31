---
name: Node CLI entrypoint paths
description: Detect directly invoked Node scripts when package commands pass a relative script path.
---

When deciding whether an ES module is the directly invoked CLI entrypoint, resolve `process.argv[1]` against the current working directory before comparing it with the absolute path from `import.meta.url`.

**Why:** The API package invokes its cleanup script with a relative path. Comparing that raw argument to `fileURLToPath(import.meta.url)` silently skipped cleanup and left an old API listener occupying the configured port.

**How to apply:** Use a small pure path-comparison helper and a unit test for relative, nonmatching, and absent script arguments. Keep process termination separately restricted to the exact owned process.
