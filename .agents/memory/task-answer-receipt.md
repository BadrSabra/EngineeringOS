---
name: Task answer receipt verification
description: Bind answer assertions to the current task execution receipt rather than clipped progress logs
---

Task logs are bounded operator summaries, not authoritative full answer text. For task-level answer checks, read the task detail's current execution receipt and bind its operation ID to the exact accepted execution ID; assert answer content from that receipt, not from a progress-log message.

**Why:** A clipped log can end before later claim and source details, making an otherwise correct answer appear incomplete or hiding an incorrect one. The current pointer-validated receipt is the durable task result.

**How to apply:** In Mission/browser journeys, load task details after terminal completion, verify the receipt kind and successful status, match its operation ID to the accepted execution, then check the receipt summary. Keep those checks separate from Canonical Proof assertions.
