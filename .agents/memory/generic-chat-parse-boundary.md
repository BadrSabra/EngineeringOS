---
name: Generic chat parse boundary
description: The distinction between malformed JSON-looking generic chat output and valid plain prose fallback.
---

Malformed JSON-looking output in ordinary chat must remain terminal and must not be returned as usable response text. The server-owned parser-failure sentinel must also remain terminal if it arrives as plain text; plain prose, including fenced prose, is still valid generic-chat content.

**Why:** The orchestrator has tolerant fallback parsing for provider compatibility, and the API sanitizer can emit the parser-failure sentinel. Without a final response-boundary check, either path can turn a failed response into `SUCCEEDED/ACCEPTED`. Treating every parser failure as terminal would still break existing plain-prose behavior.

**How to apply:** Reuse one exact sentinel constant/predicate at the response boundary. Gate fail-closed behavior on the generic CHAT path and that exact sentinel (plus object-looking malformed output), before success persistence. Preserve structured fallback reports for task and forensic paths, and preserve unrelated plain prose.