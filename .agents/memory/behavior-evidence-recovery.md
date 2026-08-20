---
name: Behavior evidence recovery
description: Durable rule for converting completed source reads into accepted behavioral evidence.
---

Normal behavior questions may finish with completed reads but no accepted evidence when the provider omits an exact executable quote. The system may make one bounded, no-tool citation-correction pass over retained reads; it must never broaden scope or convert a missing proof into a positive verdict.

**Why:** A read receipt proves inspection, not behavior. Repeated recovery calls increase latency and can turn a provider failure into a long loop without improving evidence quality.

**How to apply:** Keep the correction pass separate from capability-probe recovery, validate the recovered quote against the server-owned read manifest and source span, and preserve `ANALYSIS_INCOMPLETE` when no quote supports the claim.