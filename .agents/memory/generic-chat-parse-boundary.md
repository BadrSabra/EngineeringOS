---
name: Generic chat parse boundary
description: The distinction between malformed JSON-looking generic chat output and valid plain prose fallback.
---

Malformed JSON-looking output in ordinary chat must remain terminal and must not be returned as usable response text. Plain prose, including fenced prose, is still a valid generic-chat response and must not be rejected merely because the strict JSON parser cannot validate it.

**Why:** The orchestrator has tolerant fallback parsing for provider compatibility, but that fallback can turn a malformed JSON envelope into content that the storage or stream boundary mistakes for a successful answer. Treating every parser failure as terminal would break existing plain-prose behavior.

**How to apply:** Gate the fail-closed response behavior on the generic CHAT path and an object-looking response after trimming. Preserve structured fallback reports for task and forensic paths, and preserve plain prose for ordinary chat.