---
name: Gap query routing
description: Routing boundary for analytical weakness and gap questions.
---

Gap and weakness questions are proof-backed `PROJECT_QUERY` turns, not ordinary low-risk chat and not automatically broad forensic audits; targeted wording such as “حدد نقاط الضعف” must not escalate by itself. Objective claim IDs are unique, and an explicit request to expand analysis scope requires fresh scope consent rather than inheriting the prior objective.

**Why:** A generic question such as “What are the agent's weaknesses?” can be classified as a simple/code question before the gap signal is considered. That lets a provider answer without the required target, source manifest, or semantic acceptance.

**How to apply:** Keep the low-risk fast path explicitly excluded for gap signals, dedupe claims when constructing or merging resumable project-query objectives, and fail closed on duplicate IDs at schema/state boundaries. Reserve `FULL_FORENSIC_AUDIT` for explicit broad discovery/audit wording, and ask for a new boundary before expanding an existing analysis.

Explicit short generic gap questions must not inherit an embedded-AI target merely because the session has one. A domain-qualified weakness follow-up may inherit the embedded target only when its wording carries the embedded-agent scope that the existing weakness claim is designed for; bare “gaps?” and generic project-gap wording must start the gap-analysis contract.

**Why:** A live Arabic session stored the second `الفجوات؟` turn as `PROJECT_QUERY_EMBEDDED-AI`, accepted a general architecture explanation as `PROVEN`, and never applied the gap-language gate that exists for `PROJECT_QUERY_GAP-ANALYSIS`.

**How to apply:** Keep explicit continuation markers and bounded same-topic follow-ups resumable; separate generic gap wording from domain-qualified embedded-agent weakness wording in one state-aware predicate. If inherited embedded scope remains supported, its answer contract must still require a gap-specific result rather than only the old architecture flow.