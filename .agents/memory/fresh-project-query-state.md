---
name: Fresh project-query state
description: Session evidence state is reusable only for bounded continuations or explicit execution handoffs.
---

Fresh project questions can still be tool-backed or forensic, so classifying a turn as non-CHAT is not sufficient reason to inherit the previous session's target and evidence requirements.

**Why:** Reusing persisted state for any non-CHAT turn lets unrelated questions inherit stale project scope and can repeat or misdirect evidence reads.

**How to apply:** Require a recognized continuation pattern with a persisted target, or an explicit execution/build handoff, before passing session task state into classification and provider inputs. New project queries should establish their own server-owned scope.