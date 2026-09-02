---
name: Forensic resume contract
description: Durable requirements for recovering failed forensic chat turns without reclassifying short continuation messages as ordinary chat.
---

Persist the server-owned forensic task contract before provider or tool work begins. It must retain the task/output contract, scope, project revision, session identity, and execution identity, and late writes must obey the session progress timestamp fence.

**Why:** A provider or tool failure can occur before the final assistant persistence path. If the session state is only written on success, a later “continue”/“start” message is classified as CHAT and runs without tools or acceptable evidence.

**How to apply:** New executions write the contract before model work; resumed turns reuse it authoritatively. Legacy sessions may be rebuilt only from a failed/paused proof-required execution with a stored workspace revision; otherwise fail closed instead of guessing scope.