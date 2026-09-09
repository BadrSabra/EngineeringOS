---
name: Evidence failure projection
description: Durable rules for user-facing and terminal evidence status when an AI analysis fails.
---

Provider failures in evidence-required turns must project the observed evidence state, not assume that failure happened before all reads. Distinguish no source read, attempted but incomplete reads, and retained complete reads with incomplete coverage. Keep provider diagnostics out of user-facing messages and terminal evidence reasons.

**Why:** A provider can fail after useful source evidence has already been retained; claiming that no files were read hides progress and misleads resume behavior.

**How to apply:** Build the summary from the current trace plus retained complete evidence before persisting the assistant failure or terminal execution state. Preserve cancellation precedence and ordinary-chat wording.