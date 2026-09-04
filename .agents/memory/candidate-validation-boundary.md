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

Intermediate delivery states are not direct apply permissions: `isolated`, `abandoned`, and unknown `conflicted` states require recovery validation; a conflicted retry is allowed only when the apply journal proves it was blocked before promotion or rolled back cleanly.

**Why:** A pending proposal can survive a process crash after live-root promotion has started, and replaying it without durable stage evidence can duplicate or overwrite an uncertain delivery.

**How to apply:** Gate every apply retry on the persisted lifecycle and latest proposal-scoped journal stage; keep no-promotion blocked results retryable, but fail closed for missing, promoted, or rollback-failed evidence.