---
name: Non-stream chat terminal barrier
description: Durable execution and Episode state must settle before a non-streaming chat response is sent.
---

For `POST /api/ai/chat`, do not rely on async cleanup in `finally` to finish before a successful or early error response reaches the caller. Settle the observation Episode and execution before sending terminal JSON or invoking a response-writing error helper such as `handleOrchestratorError`; keep `finally` as a fallback for thrown errors.

**Why:** Focused route tests observed responses before awaited `finally` terminalization completed. Error helpers can send a 503 before returning, leaving the durable execution temporarily running after the client receives the error.

**How to apply:** Before any response path after the first read callback, including a helper that writes the response internally, await a lease- and attempt-fenced terminal transition. Preserve cancellation and lease-loss paths; do not create acceptance or EffectBundle records for observation-only work.