---
name: Mutation lifecycle decisions
description: Shared validation failure taxonomy and bounded repair decisions across delivery, repair, browser, and runtime paths.
---

Validation outcomes must carry a server-owned failure kind before repair logic decides what happens next. Only candidate failures may trigger a bounded candidate repair; timeouts may retry validation without changing the candidate; unavailable, scope, conflict, and cancellation outcomes must not authorize model mutation.

**Why:** Treating harness failures and candidate failures alike can cause the agent to edit a correct candidate or hide missing proof behind a retry. The existing runtime/browser callers also require stable legacy result shapes.

**How to apply:** Use the canonical ValidationResult plus lifecycle repair decision for new paths. Keep existing boolean/status runtime projections as compatibility adapters, and do not use them as acceptance authority.