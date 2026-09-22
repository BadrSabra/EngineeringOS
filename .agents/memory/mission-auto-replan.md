---
name: Automatic Mission replan
description: Constraints for closed-loop recovery after a Mission Goal enters needs_replan.
---

Automatic replan must run after terminal acceptance commits, under a Mission row lock, and must create a new server-owned plan revision before dispatching only its dependency roots. The active revision is recorded on the Mission so historical Goals cannot poison current status, and stale revisions cannot be dispatched.

**Why:** Replanning inside the acceptance transaction risks deadlocks and makes terminal failure durability depend on planner/provider work. Including historical failed Goals in current status also causes every successful replan to fall back to needs_replan.

**How to apply:** Use the durable reconciliation loop as the recovery trigger, preserve old Goal/Task/Execution rows, enforce a bounded automatic-replan budget, and leave the Mission in needs_replan when no eligible root can be dispatched.