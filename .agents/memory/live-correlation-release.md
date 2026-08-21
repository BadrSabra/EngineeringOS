---
name: Live mission correlation release check
description: The browser release journey has an opt-in live-provider mode that emits only bounded correlation metadata.
---

The live-provider acceptance path must remain opt-in and use a disposable project plus the isolated Clerk user. Its exported report may include operationId, workspace revision, bounded counts, terminal state, and safe IDs, but never provider credentials, prompts, model responses, source bodies, or resume tokens.

**Why:** Normal release smoke tests must stay deterministic and provider-free, while live acceptance still needs one auditable cross-surface run.

**How to apply:** Keep live execution behind an explicit environment flag and validate the report after Playwright exits; treat failover, unavailable, failed, and cancelled terminals as explicit non-success outcomes.