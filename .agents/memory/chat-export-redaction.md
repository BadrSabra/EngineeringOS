---
name: Chat export redaction
description: Durable boundary for AI provider data crossing chat persistence and user-facing JSON/SSE responses.
---

Provider-derived chat data must be recursively redacted before it is persisted or returned through JSON/SSE. This includes assistant text, sources, tool arguments/results, repair metadata, evidence, task results, and provider context; raw provider diagnostics may remain server-side for troubleshooting.

**Why:** A route can be safe for the main response while still leaking deployment paths or opaque request IDs through a nested source, tool trace, or provider error field.

**How to apply:** When adding a new chat export field, classify it as provider-derived and pass it through the shared user-facing redaction helper. Keep operational correlation IDs separate from provider payloads when clients need them.