---
name: Chat export redaction
description: Durable boundary for AI provider data crossing chat persistence and user-facing JSON/SSE responses.
---

Provider-derived data must be recursively redacted before it is persisted or returned through any AI JSON/SSE boundary. This includes assistant text, sources, tool arguments/results, repair metadata, evidence, task results, provider context, structured analysis/review results, workflow decisions, and task errors; raw provider diagnostics may remain server-side for troubleshooting.

**Why:** A route can be safe for the main response while still leaking deployment paths or opaque request IDs through a nested source, tool trace, or provider error field.

**How to apply:** When adding a new AI response or persisted event field, classify it as provider-derived and pass it through the shared user-facing redaction helper. Keep operational correlation IDs separate from provider payloads when clients need them, and never expose parser raw output. User-facing failure events should contain only stable codes/context; keep the full provider error in server logs. Legacy persisted trace entries also need schema validation and a fresh public projection when read back. Live benchmark health results must likewise project model/reason fields before callbacks or airlock persistence, and catalog failures should retain stable status codes rather than transport text.