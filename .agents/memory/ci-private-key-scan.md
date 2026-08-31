---
name: CI private-key scan safety
description: Repository secret scanners must not follow untrusted special paths or read unbounded file contents.
---

CI checks that inspect tracked files must use metadata-safe, bounded reads: reject key-like paths first, inspect only regular files, avoid symlink/device/FIFO traversal, and cap content reads.

**Why:** A tracked symlink or special file can otherwise redirect a blocking CI read outside the repository or make an unbounded read exhaust the runner.

**How to apply:** Preserve these constraints whenever extending repository-content security checks or adding new tracked-file scanners.