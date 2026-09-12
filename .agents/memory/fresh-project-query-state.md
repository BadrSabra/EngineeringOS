---
name: Fresh project-query state
description: Session evidence state is reusable only for bounded continuations or explicit execution handoffs.
---

Fresh project questions can still be tool-backed or forensic, so classifying a turn as non-CHAT is not sufficient reason to inherit the previous session's target and evidence requirements.

**Why:** Reusing persisted state for any non-CHAT turn lets unrelated questions inherit stale project scope and can repeat or misdirect evidence reads.

**How to apply:** Require a recognized continuation pattern with a persisted target, or an explicit execution/build handoff, before passing session task state into classification and provider inputs. New project queries should establish their own server-owned scope.

Continuation recognition must cover user-facing language variants, including common Arabic orthographic and diacritic forms, while remaining gated by a persisted project-query target.

**Why:** A real Arabic “more details” follow-up used a diacritic form that a narrowly written matcher missed, causing an otherwise valid grounded conversation to fall into provider-only CHAT.

**How to apply:** Test both vocalized and unvocalized forms for each supported short follow-up, and keep the same no-state negative tests so generic short questions cannot inherit stale evidence.

Terminal SSE state construction must carry the resolved project-query target again; the initial state candidate does not survive automatically into the final persistence seam.

**Why:** The stream classified and executed a grounded PROJECT_QUERY correctly, but the terminal state builder omitted the target and silently cleared the session state after acceptance.

**How to apply:** Keep a regression that verifies the accepted SSE turn leaves its project-query scope in session state, then exercises a bounded follow-up after state recovery.