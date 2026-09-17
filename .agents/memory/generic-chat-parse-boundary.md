---
name: Generic chat parse boundary
description: The distinction between malformed JSON-looking generic chat output and valid plain prose fallback.
---

Malformed JSON-looking output on any chat turn must remain terminal and must not be returned as usable response text. The server-owned parser-failure sentinel must also remain terminal if it arrives as plain text; plain prose, including fenced prose, is still valid generic-chat content. Evidence-required turns project a server-owned incomplete fallback from retained reads instead of the invalid provider text.

**Why:** The orchestrator has tolerant fallback parsing for provider compatibility, and the API sanitizer can emit the parser-failure sentinel. Without a final response-boundary check, either path can turn a failed response into `SUCCEEDED/ACCEPTED`. Treating every parser failure as terminal would still break existing plain-prose behavior.

**How to apply:** Reuse one exact sentinel constant/predicate at the response boundary. Classify parser failures before success persistence, expose one bounded retryable terminal outcome, and preserve structured fallback reports for evidence/task paths. Preserve unrelated plain prose.