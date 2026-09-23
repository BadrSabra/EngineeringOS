---
name: Canonical proof foundation
description: Server-only completion proof must bind durable acceptance, execution, evidence, scope, revision, candidate, and delivery identities.
---

The canonical completion verdict is composed from the durable execution, acceptance row, retained evidence snapshot, and Goal/Mission scope. Goal/Mission JSON acceptance is only a projection and cannot establish completion by itself.

**Why:** Provider success and copied projection fields can disagree with server-owned evidence or identity bindings; accepting either one alone can mark a stale, incomplete, or cross-scope execution as complete.

**How to apply:** Keep completion gates on the canonical composition layer, validate projection fields against acceptance/evidence, and preserve one database lock order (Mission before Goal) for Mission and Goal terminal checks.

Mission projections must revalidate stored Skill Candidate envelopes and their embedded execution-proof projection before exposing them to the dashboard; stored proposal JSON is not trusted presentation data.

**Why:** Candidate envelopes contain provider/runtime-derived fields and can outlive the acceptance that created them. Revalidating at the read boundary prevents malformed or unbound candidates from appearing as proven after reload.

**How to apply:** Use the existing Skill Candidate validator plus execution-proof parser in projection builders, and expose only a bounded proof summary to clients.

The foundation is not yet the sole authority: task/workflow/recipe status synchronization and candidate/shadow validation still contain independent projection-based checks. Consolidate those callers before treating replay or promotion as proof-carrying.

**Why:** A strong composer cannot prevent weaker callers from marking a Goal complete or accepting a candidate before the canonical execution/acceptance/evidence rows are reloaded and bound.

**How to apply:** Add a server-owned row-loading canonical-proof service, route every terminal/candidate decision through it, then make replay receipts and promotion eligibility reference that same proof identity.