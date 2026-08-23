---
name: Browser validation block reasons
description: Safe reason codes and operator guidance for browser validation preflight blocks.
---

Browser validation preflight failures expose only an allowlisted reason code: ownership, invalid profile, resource limit, or stale revision. The dashboard translates those codes into safe next actions; provider errors and runtime diagnostics remain server-only.

**Why:** Operators need to understand why a rerun is unsafe without receiving paths, profile internals, or other diagnostics that can contain sensitive data.

**How to apply:** Preserve the reason code through the public validation contract, SSE parsing, persisted traces, and audit/recovery projections. Add new reasons only with matching redacted dashboard guidance.