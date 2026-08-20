---
name: Empty provider recovery
description: Durable rule for provider timeouts and empty model responses after source reads.
---

When an evidence-oriented run has completed reads but the provider returns no final text, render a deterministic `ANALYSIS_INCOMPLETE` report from the server-owned read manifest. Do not retry synthesis indefinitely or emit a generic language/blocked message.

**Why:** The user needs to see that reads occurred and why no behavioral conclusion was accepted; a missing model response must not erase the evidence state or imply a verdict.

**How to apply:** Keep the report free of model claims and internal recovery diagnostics, list only completed reads, state that no executable excerpt closed the claim, and preserve the next-step guidance without treating the result as a Finding or final negative verdict.