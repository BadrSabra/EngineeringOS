---
name: AI verification boundary
description: AI-generated task steps are narrative outcomes, while verification checks are server-owned evidence gates.
---

AI-generated remediation steps must not be treated as automatic verification checks. Only server-owned checks with explicit results can contribute automatic verification evidence; operator guidance requires a human-recorded result and evidence.

**Why:** Treating model narrative steps as automatic checks can permanently block a remediation task even after every required operator check passes, while treating them as passed would allow unsupported AI-only completion.

**How to apply:** Keep model-derived outcomes visibly incomplete when human verification is required, and distinguish them from actual automatic checks produced by trusted server-side verification logic.