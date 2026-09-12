---
name: Delivery test cleanup
description: Recovery route tests share the server delivery root with checked-in fixtures.
---

Recovery tests must remove only the operation-specific workspace roots they create; never clear the shared delivery directory wholesale.

**Why:** The configured delivery root can contain tracked fixture workspaces as well as runtime-created recovery workspaces, so broad cleanup can delete repository files.

**How to apply:** Track each generated workspace path and clean those exact paths in test teardown. Before deleting scan-job rows, wait for project-owned queued/running workers to reach a terminal state; the scan-job foreign key uses `ON DELETE SET NULL` on graph rows, so deletion can deadlock with an active scanner transaction.