---
name: Short imperative routing
description: Short execution commands must be recognized before simple-chat classification.
---

Server-side routing must detect normalized imperative execution language before applying any length-based or low-risk chat shortcut. A command that reaches `CHAT` can receive a successful provider response and acceptance despite never creating an execution, tool trace, or evidence record.

**Why:** Short Arabic and English commands such as “تشغيل الفحص” are valid user instructions but can look like simple two-word messages; the provider cannot repair a routing decision after tools have been withheld.

**How to apply:** Keep command detection centralized and language-aware, make the execution route server-owned, and require regression coverage for unvocalized/vocalized Arabic plus English scan commands. A command-like turn must fail closed or execute; it must never silently downgrade to narrative chat.