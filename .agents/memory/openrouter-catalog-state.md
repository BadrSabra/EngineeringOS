---
name: OpenRouter catalog state
description: Distinguishes authoritative live model snapshots from failed or expired refresh attempts.
---

Only a successful, usable live model snapshot is an authoritative boundary for free-model filtering. A refresh attempt that fails, returns no usable free IDs, or expires must not turn the static compatibility catalog into an empty candidate set.

**Why:** Treating “refresh attempted” as “catalog loaded” caused valid chat requests to report that no free chat model existed during temporary catalog outages or stale metadata windows.

**How to apply:** Use the usable snapshot for filtering and re-resolve pinned models after request-time refreshes; keep catalog status and attempted model IDs in safe diagnostics without credentials.