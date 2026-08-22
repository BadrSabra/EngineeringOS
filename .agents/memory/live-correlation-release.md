---
name: Live mission correlation release check
description: The browser release journey has an opt-in live-provider mode that emits only bounded correlation metadata.
---

The live-provider acceptance path must remain opt-in and use a disposable project plus the isolated Clerk user. Its exported report may include operationId, workspace revision, bounded counts, terminal state, and safe IDs, but never provider credentials, prompts, model responses, source bodies, or resume tokens.

**Why:** Normal release smoke tests must stay deterministic and provider-free, while live acceptance still needs one auditable cross-surface run.

**How to apply:** Keep live execution behind an explicit environment flag and validate the report after Playwright exits; treat failover, unavailable, failed, and cancelled terminals as explicit non-success outcomes.

For free-tier live-provider checks, use a narrow exact-file forensic prompt and an explicit Playwright timeout. Broad prompts can trigger long tool loops or upstream rate limits, while wording such as “run a mission” is reserved for session-bound execution handoffs.

**Why:** The first live attempts either hit the session-required guard or exceeded the transport bound during repeated provider tool calls; an exact-file run completed within the bounded journey.

**How to apply:** Keep the default prompt non-executing, pass a focused prompt through `DASHBOARD_E2E_LIVE_PROMPT`, and allow the test timeout to exceed `DASHBOARD_E2E_LIVE_TIMEOUT_MS`.

Successful live mission correlation reports must prove at least one accepted
evidence item and one validation checkpoint; missing either is a report
failure, while blocked, cancelled, failed, and unavailable outcomes remain
explicit non-success results.

**Why:** A provider-backed ordinary-chat completion can be valid while proving
nothing about the mission evidence contract.

**How to apply:** Keep the live objective explicitly forensic and make the
redacted report builder reject successful terminals with empty proof surfaces.