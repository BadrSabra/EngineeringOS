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

Prefetch is part of the durable evidence boundary only when every accepted prefetch body is mirrored into the request-scoped retained-read map used by terminal acceptance; the private prefetch cache alone is not proof.

**Why:** The first evidence read can be acquired before the tool loop and therefore never pass through the loop's retained-body callback. Keeping it only in the prefetch map makes failure snapshots report zero reads even though the trace shows a completed read.

**How to apply:** When adding a prefetch source, update both the loop/cache evidence map and the shared retained map at the same acceptance point; use that shared map for success, failure, retry, and history projections.

Runtime failure summaries must use the same byte-limit and read-status normalization as acceptance snapshots. A retained prefetch body larger than the acceptance limit is not a complete proof, even if the in-memory map still contains the raw body.

**Why:** A provider failure can otherwise produce a message saying complete evidence was retained while the durable snapshot correctly marks the same body truncated, making reload and resume disagree with the original turn.

**How to apply:** Normalize retained reads once before building failure text, checkpoints, acceptance, or resumability; preserve the raw body only in the bounded private path needed for diagnostic hashing, never as a second “complete” evidence view.