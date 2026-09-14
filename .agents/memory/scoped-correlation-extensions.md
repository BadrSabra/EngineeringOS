---
name: Scoped correlation extensions
description: Compatibility rule for extending shared analysis correlation payloads.
---

New correlation or provenance fields should be emitted only for the request mode that
requires them, unless the public contract is intentionally versioned for every caller.

**Why:** Existing reconnect and fixture consumers may compare correlation payloads
exactly. Adding an optional field to ordinary requests can change legacy behavior even
when the field is semantically harmless.

**How to apply:** Gate session-specific identity or audit metadata on the corresponding
server-owned intent, while keeping ordinary chat and legacy resume projections unchanged.