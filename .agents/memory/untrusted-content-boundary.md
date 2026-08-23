---
name: Untrusted content boundary
description: Repository, tool, memory, and checkpoint text must remain evidence/data when passed to AI.
---

All repository-derived and durable-run text crossing into an AI prompt must use an explicit untrusted-data envelope with source metadata and bounded content. Server authorization must remain independent of that text.

**Why:** README, diffs, validation output, and session memory can contain prompt injection that asks for secrets, scope expansion, commands, or approval bypass.

**How to apply:** Preserve raw evidence only for server-side citation checks; send bounded labeled copies to the model, and re-check tool manifests, approved paths, validation profiles, and approval state after every model turn.