---
name: Candidate validation boundary
description: Delivery validation must target the exact immutable candidate that will be promoted.
---

The isolated delivery workspace, its changeset hash, validation evidence, and promoted bytes must form one integrity chain; validating the live root after creating a candidate is not evidence about the candidate.

**Why:** A guarded apply can otherwise report a successful check for a different tree than the artifact being delivered, while sequential promotion can still leave partial state after a crash.

**How to apply:** Any future apply, repair, browser, commit, or recovery work must bind the validator to the operation workspace and content hash before promotion, then make interruption resolve to a terminal known state.

Preflight against the live root must be read-only; create missing parent directories only inside the guarded promotion after the live-root drift baseline is captured.

**Why:** Creating an otherwise empty parent during preflight changes the live tree digest and can falsely look like an external edit, blocking a valid candidate before promotion.

**How to apply:** Resolve existing path components and symlinks without `mkdir`; perform directory creation as part of the serialized, rollback-covered promotion.