---
name: Short imperative routing
description: Short execution commands must be recognized before simple-chat classification.
---

Server-side routing must detect normalized imperative execution language before applying any length-based or low-risk chat shortcut. A command that reaches `CHAT` can receive a successful provider response and acceptance despite never creating an execution, tool trace, or evidence record.

**Why:** Short Arabic and English commands such as “تشغيل الفحص” are valid user instructions but can look like simple two-word messages; the provider cannot repair a routing decision after tools have been withheld. Benchmark fixture prompts also pass through the production intent detector: wording that is clear to a person but outside its anchored execution grammar can leave repair cases in chat mode and create false model-quality failures.

**How to apply:** Keep command detection centralized and language-aware, make the execution route server-owned, and require regression coverage for unvocalized/vocalized Arabic plus English scan commands. Run each generated benchmark prompt through the same intent resolver and assert execution intent plus server-owned scope/approval binding before a live campaign. A command-like turn must fail closed or execute; it must never silently downgrade to narrative chat.

Structured task cards may place an acceptance header and an actionable checklist on separate lines. Require both signals across the message rather than on one line, while keeping write approval independent from intent classification.

**Why:** requiring the header and action in the same sentence routed valid multiline implementation requests into ordinary chat; recognizing the task must not grant write authority.

**How to apply:** combine a recognized task header with at least one positive, explicit implementation action across message clauses. Continue to enforce the existing server-owned approval checks before write-capable tools are exposed or dispatched.