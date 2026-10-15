---
name: Chat recovery binding equality
description: Keep replayed structured contracts bound by value rather than incidental JSON object-key order.
---

Compare object-valued execution bindings structurally, not by comparing `JSON.stringify` output. JSON parsing and Zod validation can reorder keys without changing the contract; array order remains significant.

**Why:** A stored project-query objective and the same objective after Zod parsing had different key order, so automatic recovery returned HTTP 200 with `EXECUTION_BINDING_MISMATCH` before invoking the provider.

**How to apply:** Preserve exact comparisons for identity strings such as message, project, and session. Use structural equality for validated object contracts and keep a route-level replay test that crosses the persistence and schema-parse boundaries.
