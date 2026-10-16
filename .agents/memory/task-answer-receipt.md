---
name: Task answer receipt verification
description: Bind answer assertions to the current task execution receipt rather than clipped progress logs
---

Task logs are bounded operator summaries, not authoritative full answer text. For task-level answer checks, read the task detail's current execution receipt and bind its operation ID to the exact accepted execution ID; assert answer content from that receipt, not from a progress-log message.

**Why:** A clipped log can end before later claim and source details, and the user-text redactor replaces UUIDs with `[internal id]`; applying it to server-owned receipt identities breaks binding and hides a valid answer. Retries can also leave multiple execution rows under the same task correlation. Evidence-graph source revisions and live workspace revisions have different contracts; equating them can reject valid proof. Historical excerpts must remain tied to the accepted snapshot after files change, while redaction protects sensitive source text without changing the hash of its original bytes.

**How to apply:** Preserve validated machine identities without user-text redaction. Resolve receipts through the task's current correlation, require a unique highest attempt, and match operation ID, correlation ID, and attempt exactly; fail closed on ties. In Mission/browser journeys, load task details after terminal completion, match the receipt to the accepted execution, then check its summary separately from Canonical Proof assertions. For project-query answer proof, validate each claim's path, lines, and excerpt hash against the fresh source snapshot; record the graph source revision and current workspace revision separately. Persist UI excerpts from that verified snapshot, redact only their display text while retaining the hash of the original excerpt, and show an explicit omission reason if the receipt size bound prevents storing text; never refetch from a mutable workspace in the UI.
