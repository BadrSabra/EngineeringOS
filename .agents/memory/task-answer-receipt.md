---
name: Task answer receipt verification
description: Bind answer assertions to the current task execution receipt rather than clipped progress logs
---

Task logs are bounded operator summaries, not authoritative full answer text. For task-level answer checks, read the task detail's current execution receipt and bind its operation ID to the exact accepted execution ID; assert answer content from that receipt, not from a progress-log message.

**Why:** A clipped log can end before later claim and source details, making an otherwise correct answer appear incomplete or hiding an incorrect one. Retries can leave multiple execution rows under the same task correlation, so rejecting every multi-row match hides a valid current receipt while accepting an older row breaks attempt binding.

**How to apply:** Resolve receipts through the task's current correlation, require a unique highest attempt, and match operation ID, correlation ID, and attempt exactly; fail closed on ties. In Mission/browser journeys, load task details after terminal completion, match the receipt to the accepted execution, then check its summary separately from Canonical Proof assertions.
