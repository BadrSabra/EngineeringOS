---
name: Session state concurrency
description: Persistence rules for resumable chat state when same-session turns complete out of order.
---

When concurrent chat turns update resumable session state, qualify the state write itself by the allocated turn timestamp; a conditional expression inside an otherwise-unconditional update can still allow an older completion to overwrite newer state after row-lock waits.

**Why:** The database update must re-evaluate ownership of the state transition after concurrent transactions serialize, not merely compute a value from a stale snapshot.

**How to apply:** Use an atomic timestamp-qualified update for active session state, then advance the session timestamp monotonically.