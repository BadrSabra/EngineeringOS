---
name: Analysis deadline race
description: Distinguishes request deadline expiry from caller cancellation when dispatch races an abortable runner.
---

When a dispatcher enforces an absolute request deadline by aborting a child signal and racing promises, the abort listener may settle the cancellation promise before the timeout promise wins. Set an explicit deadline-expired flag inside the timer callback before aborting; use that state to classify the terminal result rather than relying only on a later clock read.

For nested provider requests, pass the remaining caller-owned deadline into the transport instead of relying on a shorter transport default. Leave a small margin so the transport can classify its own timeout before the outer deadline aborts.

**Why:** A runner-ignores-deadline test exposed a timeout being reported as cancellation because the signal-abort contender settled first. An empirical review also configured a 90-second case budget while the provider client silently used its 60-second default.

**How to apply:** Preserve the distinction between caller cancellation and request-deadline expiry in any executor-level race that aborts a runner when its timer fires. When an inner provider request has a timeout, pass its remaining budget with enough margin for a typed timeout result and cleanup.