---
name: Gap query routing
description: Routing boundary for analytical weakness and gap questions.
---

Gap and weakness questions are proof-backed `PROJECT_QUERY` turns, not ordinary low-risk chat and not automatically broad forensic audits; targeted wording such as “حدد نقاط الضعف” must not escalate by itself. Objective claim IDs are unique, and an explicit request to expand analysis scope requires fresh scope consent rather than inheriting the prior objective.

**Why:** A generic question such as “What are the agent's weaknesses?” can be classified as a simple/code question before the gap signal is considered. That lets a provider answer without the required target, source manifest, or semantic acceptance.

**How to apply:** Keep the low-risk fast path explicitly excluded for gap signals, dedupe claims when constructing or merging resumable project-query objectives, and fail closed on duplicate IDs at schema/state boundaries. Reserve `FULL_FORENSIC_AUDIT` for explicit broad discovery/audit wording, and ask for a new boundary before expanding an existing analysis.

Explicit short gap questions must not inherit an embedded-AI target merely because the session has one; if product semantics treats them as follow-ups, the new contract must carry gap-specific answer requirements rather than only the old target.

**Why:** A live Arabic session stored the second `الفجوات؟` turn as `PROJECT_QUERY_EMBEDDED-AI`, accepted a general architecture explanation as `PROVEN`, and never applied the gap-language gate that exists for `PROJECT_QUERY_GAP-ANALYSIS`.

**How to apply:** Distinguish explicit continuation markers from topical gap restatements at the routing boundary, then test the persisted request, target, objective type, and terminal semantic verdict together.