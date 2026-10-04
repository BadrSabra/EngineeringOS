---
name: Analysis deadline race
description: Distinguishes request deadline expiry from caller cancellation when dispatch races an abortable runner.
---

When a dispatcher enforces an absolute request deadline by aborting a child signal and racing promises, the abort listener may settle the cancellation promise before the timeout promise wins. Set an explicit deadline-expired flag inside the timer callback before aborting; use that state to classify the terminal result rather than relying only on a later clock read.

**Why:** A runner-ignores-deadline test exposed a timeout being reported as cancellation because the signal-abort contender settled first.

**How to apply:** Preserve the distinction between caller cancellation and request-deadline expiry in any executor-level race that aborts a runner when its timer fires.