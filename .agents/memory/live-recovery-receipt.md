---
name: Live recovery receipts
description: Safe evidence assembly for provider-backed process-recovery campaigns.
---

Live recovery receipts must be built from an allowlisted test evidence payload plus wrapper-owned revision, build, timing, and test-count metadata; never serialize provider diagnostics, credentials, source contents, or user data.

**Why:** A completed durable execution checkpoint can omit its model-call entries even though the live child selected a model successfully. The child runtime's structured model-selection event is the reliable fallback, but its full diagnostics must remain in memory only.

**How to apply:** Have the recovery test emit only safe milestones after fixture teardown, capture provider/model fields with strict validation, and atomically replace the prior receipt only after the child, evidence, counts, and teardown all pass.