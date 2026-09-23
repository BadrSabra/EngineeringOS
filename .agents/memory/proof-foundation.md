---
name: Canonical proof foundation
description: Server-only completion proof must bind durable acceptance, execution, evidence, scope, revision, candidate, and delivery identities.
---

The canonical completion verdict is composed from the durable execution, acceptance row, retained evidence snapshot, and Goal/Mission scope. Goal/Mission JSON acceptance is only a projection and cannot establish completion by itself.

**Why:** Provider success and copied projection fields can disagree with server-owned evidence or identity bindings; accepting either one alone can mark a stale, incomplete, or cross-scope execution as complete.

**How to apply:** Keep completion gates on the canonical composition layer, validate projection fields against acceptance/evidence, and preserve one database lock order (Mission before Goal) for Mission and Goal terminal checks.