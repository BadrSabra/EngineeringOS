---
name: Goal draft continuity
description: Product boundaries between client draft preservation, starter creation, and durable acceptance.
---

Closing the starter dialog stops its UI continuation; it does not implicitly
cancel the server's creation job. Preserve enough context for an explicit
resume, and fence late callbacks so they cannot redirect or bind another form.

**Why:** A creation response can arrive after the user closes or replaces its
form. Treating that response as current loses goal context and can attach the
next goal to the wrong project.

**How to apply:** Preserve the original draft/request identity separately from
the currently visible form. Navigation and form updates require the current
account and local form generation. Keep server job ownership independent.

Starting to send a draft is not server acceptance. A retained client copy may
support an explicit retry, but must never automatically reinsert/retry an
attempted request or become proof, approval, or a Mission continuation.

**Why:** The browser may lose the connection before learning whether the server
admitted the request. Deleting immediately can lose the goal; automatically
replaying can duplicate effects.

**Why:** General and project chats have separate histories; restoring text in a
nearby but different session could lead the user to send it in the wrong scope.

**How to apply:** Distinguish unsent drafts, attempted text, and durable request
records. Ordinary composer continuity is tab-local and keyed by account, scope,
and exact conversation; preserve only that scope's return identifiers. Keep
GoalDraft handoffs on their separate durable path. Client draft storage never
implies server acceptance, proof, or permission.
