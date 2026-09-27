---
name: Capability environment identity
description: The versioned identity for the server capability set and its separation from authorization and legacy operation bindings.
---

The Capability Environment is compatibility evidence, not an authorization grant. Its digest is computed from the server registry's canonical projection of capability contract version, capability ID, and supported recipe versions. Exclude plugin metadata or configuration, policy/catalog details, process/profile data, project roots, runtime environment attestation, and credentials.

New recipe-operation bindings may carry the versioned identity. Legacy bindings must remain unbound and resumable under their prior semantics; never invent an environment identity for a record that predates it, and do not rewrite a legacy binding during claim, checkpoint, or terminal completion.

Compare persisted identities structurally or with canonical serialization. PostgreSQL JSONB may reorder object keys, so raw `JSON.stringify` equality can reject the same identity after a database round-trip.

**Why:** Environment identity helps detect compatibility changes without changing the server-owned authorization gates. Historical operations cannot prove which environment they used, and object-key order is not durable across JSONB reads.

**How to apply:** When changing the server registry or its contract, keep the descriptor projection narrow and update its version/digest tests. Keep approval, scope, and tool policy as the only permission sources; preserve the legacy path without fabricating evidence.