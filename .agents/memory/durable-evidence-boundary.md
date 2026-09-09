---
name: Durable evidence boundary
description: The distinction between persisted tool telemetry and complete source bodies required for acceptance proof.
---

Persisted tool traces are observability metadata, not complete source evidence. The capability and forensic gates may rely on complete bodies held in the runtime evidence map, so any durable acceptance proof must snapshot or durably reference those verifier-owned bodies before the worker releases them. A path, read event, excerpt, or hash alone cannot satisfy a contract that requires complete source reads.

**Why:** The trace serializer intentionally omits tool output bodies to protect the public history surface and keep records bounded. Treating that trace as an immutable proof snapshot would allow a run to look complete after the source body needed to verify it has disappeared.

**How to apply:** Build the evidence manifest from the final verifier state before synthesis/terminalization, fail closed on missing or truncated required bodies, and expose only a redacted manifest/reference projection to clients. Failure and cancellation finalizers should reuse the same bounded retained-body projection only for evidence-required turns; preserve their non-success verdict and resumability independently.

Public `sources` projections must follow the same boundary: derive them from server-owned complete or targeted read statuses (including server-owned retained-read lists), never from provider-returned source names or source arrays. Provider-failure finalizers must pass that verified projection explicitly or the durable history can lose valid complete reads while still retaining untrusted paths in telemetry.

**Why:** A provider can name a truncated or failed path as a source, and provider-failure persistence has a separate code path from normal result persistence. Both cases can make the public history disagree with the verifier unless the read ledger is the only authority.

**How to apply:** Attach a read status to every read tool-result event, preserve it for cached and targeted reads, filter public sources to complete/targeted reads, and reuse the same collector in success and provider-failure persistence.