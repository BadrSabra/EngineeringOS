---
name: Dashboard proof fixture contracts
description: Durable rule for browser fixtures that exercise proof-bearing AI executions across resume and reload.
---

Proof-bearing resumable dashboard fixtures must keep `proofRequired` true in the terminal execution state when the user-visible contract still includes persisted proof, even after the execution becomes completed and non-resumable.

**Why:** The dashboard decides whether to render the persisted proof panel from the durable execution status after reload. If a fixture mutates only status/evidence and silently clears `proofRequired`, the product behavior is internally consistent but the browser contract loses the proof panel and masks the lifecycle being tested.

**How to apply:** When building or changing Capability Probe, forensic, or other proof-bearing resume fixtures, assert the terminal status, evidence verdict, and proof-required flag together in both the API fixture and the post-reload dashboard journey.

Targeted `PROJECT_QUERY` turns can use the normal `CHAT` operation mode; `proofRequired` is the authoritative dashboard signal for retaining their terminal proof panel.

**Why:** Filtering terminal retention by operation mode drops targeted analysis proof even though the API has preserved an incomplete, non-resumable acceptance state.

**How to apply:** In targeted-analysis fixtures, keep `turnIntent: PROJECT_QUERY`, `proofRequired: true`, and `resumable: false` together, then assert the panel remains visible without a resume action after failure and reload.

Delivery browser fixtures must include server-shaped operation evidence with candidate/revision identity and distinct apply, commit, and push receipts; a prose timeline entry is not enough to prove delivery.

**Why:** The Flight Deck can render a completed `PROVEN` execution while still missing the durable delivery chain that operators need to trust after reload.

**How to apply:** For delivery journeys, assert the redacted operation evidence chain and its receipts before and after reload, including the operation, candidate hash, project revision, and delivered-byte hash.

Mission/Goal candidate fixtures must expose both the candidate `proof` envelope and the server-shaped `canonicalProof` projection; proof assertions after a reload must expand the Goal card before reading nested content.

**Why:** The Mission projection deliberately keeps candidate proof metadata separate from the server-owned canonical acceptance projection, and Goal details are collapsed by default after a page reload.

**How to apply:** Keep fixture fields aligned with `projectCanonicalProof` (`accepted`, `verdict`, evidence snapshot, source revision, and candidate identity), and make browser journeys explicitly reopen collapsed proof-bearing Goal cards.