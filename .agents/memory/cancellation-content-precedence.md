---
name: Cancellation content precedence
description: Durable chat cancellation must keep the cancellation outcome and user-facing content semantically aligned.
---

When an execution is cancelled, the cancellation terminal outcome owns the persisted assistant content. Do not persist a lower-level model parse, language, or validation fallback as the visible content of the cancelled turn.

**Why:** A provider can return transport-level success while producing an empty or unusable response, and a client cancellation can arrive during finalization. If the terminal classifier marks the execution `INTERRUPTED` but persistence keeps the lower-level fallback text, history shows a misleading explanation such as a language mismatch instead of the actual cancellation.

**How to apply:** Resolve cancellation before selecting `content` for the terminal assistant message. Persist the bounded cancellation explanation and preserve the raw lower-level diagnostic only in redacted trace metadata. Also record who/what requested cancellation so a cancelled run can be distinguished from provider failure.