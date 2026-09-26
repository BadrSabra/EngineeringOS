---
name: Non-stream chat terminal and acceptance barriers
description: Non-stream chat must settle durable lifecycle and enforce project-query acceptance before responding.
---

For `POST /api/ai/chat`, do not rely on async cleanup in `finally` to finish before a successful or early error response reaches the caller. Settle the observation Episode and execution before sending terminal JSON or invoking a response-writing error helper such as `handleOrchestratorError`; keep `finally` as a fallback for thrown errors.

**Why:** Focused route tests observed responses before awaited `finally` terminalization completed. Error helpers can send a 503 before returning, leaving the durable execution temporarily running after the client receives the error.

**How to apply:** Before any response path after the first read callback, including a helper that writes the response internally, await a lease- and attempt-fenced terminal transition. Preserve cancellation and lease-loss paths; do not create acceptance or EffectBundle records for observation-only work.

For a non-streaming evidence-required `PROJECT_QUERY`, absence of a canonical objective is itself an incomplete acceptance state. A successful-looking provider response or complete source read is not enough to persist `SUCCEEDED`; keep project orientation on its separate contract.

**Why:** API integration showed the same objective-free incomplete response was rejected by SSE's durable acceptance gate but persisted as `SUCCEEDED` through JSON.

**How to apply:** Fail closed at non-stream terminal projection when evidence is required, no canonical objective is bound, and the turn is not project orientation. Preserve the incomplete report and do not invent fallback provenance or relax the objective-backed path.