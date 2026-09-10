---
name: Forensic resume contract
description: Durable requirements for recovering failed forensic chat turns without reclassifying short continuation messages as ordinary chat.
---

Persist the server-owned forensic task contract before provider or tool work begins. It must retain the task/output contract, scope, project revision, session identity, and execution identity, and late writes must obey the session progress timestamp fence.

**Why:** A provider or tool failure can occur before the final assistant persistence path. If the session state is only written on success, a later “continue”/“start” message is classified as CHAT and runs without tools or acceptable evidence.

**How to apply:** New executions write the contract before model work; resumed turns reuse it authoritatively. Legacy sessions may be rebuilt only from a failed/paused proof-required execution with a stored workspace revision; otherwise fail closed instead of guessing scope. When resuming, load complete source bodies from the prior attempt before claiming the row, because claiming increments the attempt and the next acceptance must remain bound to the new attempt.

The persisted `turnIntent` is part of the binding for new execution envelopes. A missing value is accepted only for legacy rows created before that field existed; a present value must match the current route intent exactly.

**Why:** Enforcing the new field against old rows would break valid reconnects, while allowing mismatches on new rows could resume a forensic or execution contract through the wrong route.

**How to apply:** Treat `undefined` as a one-way legacy compatibility case, never as a wildcard for rows that already persist `turnIntent`.