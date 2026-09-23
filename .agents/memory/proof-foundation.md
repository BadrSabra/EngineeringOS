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

Automatic task, workflow, and recipe completion plus candidate/shadow decisions now reload the canonical proof before accepting a terminal result; a successful runner without bound proof leaves the Goal in `verifying` and the public verdict `INCOMPLETE`.

**Why:** Provider or runner success and copied Goal projections can outlive, omit, or disagree with the durable execution/acceptance/evidence identities.

**How to apply:** Route every automatic terminal/candidate decision through the row-loading service; never remap an unknown result execution ID to another durable execution just to make a test or replay complete.

The canonical loader must derive delivery identity from the locked execution receipt; caller-provided delivery projections are compatibility inputs only and cannot establish delivery proof.

**Why:** A serialized delivery projection can be forged or become stale independently of the durable execution row, allowing a delivery-required goal to appear proven without an authoritative receipt.

**How to apply:** Keep delivery fields on the durable execution/receipt boundary and let the loader validate them alongside execution, attempt, operation, source revision, and candidate identity.