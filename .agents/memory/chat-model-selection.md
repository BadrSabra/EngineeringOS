---
name: Chat model selection
description: Model capability requirements for ordinary conversational turns
---

Ordinary `CHAT` turns and no-tool synthesis/recovery turns must not inherit a tool-loop or reasoning-only capability; they should resolve a compatible conversational model unless the user explicitly requests analysis, tools, or evidence.

**Why:** A forensic tool-loop model advertised `tool_calling` but not `chat`; reusing it for JSON synthesis/recovery caused capability mismatches, unnecessary fallback pressure, and could open the provider circuit for a local configuration error.

**How to apply:** Keep reasoning requirements scoped to analysis, review, workflow, and execution profiles. When transitioning from tools to no-tools on OpenRouter, resolve a `chat` chain and pin the selected candidate for each attempt; never let a bounded fallback call restart from the catalog head. Treat model-contract failures such as empty output or invalid tool calls as candidate failures, not provider-health failures. Add a regression test whenever capability handoff or chat quality hints change.