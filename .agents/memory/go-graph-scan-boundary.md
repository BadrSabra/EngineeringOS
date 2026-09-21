---
name: Go graph scan boundary
description: Cross-layer requirements for preserving internal Go import relationships during project scans.
---

Internal Go import relationships require both module metadata and file-level graph entities: the project walk must retain the root `go.mod`, and graph extraction must emit a `file` entity for each valid Go source file because relationship endpoints are file paths.

**Why:** The Go extractor can produce a valid import edge while scan persistence silently drops it if `go.mod` is absent from the walk or endpoint file entities are missing.

**How to apply:** When changing Go file discovery or graph persistence, verify the complete scan path from `go.mod` discovery through endpoint resolution and database insertion, not only the standalone extractor output.