---
name: Operator alert campaign isolation
description: How controlled release campaigns should assert operator alerts when the shared fixture database may contain unrelated active records.
---

Controlled release campaigns must scope recovery assertions to the alert kinds or fingerprints produced by that campaign. They must not require the entire active-alert response to be empty unless the campaign explicitly owns and resets every alert.

**Why:** The release journey can reuse a shared fixture database across runs. An older `ai_usage_quota_exceeded` alert remained active while a Groq catalog outage was correctly resolved, so a global empty-list assertion reported a false failure.

**How to apply:** Filter campaign assertions to the campaign-owned alert family, while still checking occurrence counts, provider/model fields, resolution, and redaction for those records.