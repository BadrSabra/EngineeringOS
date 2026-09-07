---
name: Durable evidence boundary
description: The distinction between persisted tool telemetry and complete source bodies required for acceptance proof.
---

Persisted tool traces are observability metadata, not complete source evidence. The capability and forensic gates may rely on complete bodies held in the runtime evidence map, so any durable acceptance proof must snapshot or durably reference those verifier-owned bodies before the worker releases them. A path, read event, excerpt, or hash alone cannot satisfy a contract that requires complete source reads.

**Why:** The trace serializer intentionally omits tool output bodies to protect the public history surface and keep records bounded. Treating that trace as an immutable proof snapshot would allow a run to look complete after the source body needed to verify it has disappeared.

**How to apply:** Build the evidence manifest from the final verifier state before synthesis/terminalization, fail closed on missing or truncated required bodies, and expose only a redacted manifest/reference projection to clients.