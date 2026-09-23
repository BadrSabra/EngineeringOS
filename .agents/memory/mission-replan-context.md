---
name: Mission replan context
description: Durable rule for making automatic Mission recovery materially different and evidence-aware.
---

Automatic Mission recovery must carry server-owned failure class/code, affected paths and claims, retained evidence references, and required next actions into the fresh plan snapshot. The new revision must remain distinct even when the planner produces the same source plan hash.

**Why:** A retry that cannot see the failed attempt or its proof obligations can repeat the same action and falsely look like recovery.

**How to apply:** Build recovery context from persisted Goal acceptance/checkpoint data, bound every field, store it with the new plan revision, and keep it separate from provider reasoning or mutation authority.