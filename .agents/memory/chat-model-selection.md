---
name: Chat model selection
description: Model capability requirements for ordinary conversational turns
---

Ordinary `CHAT` turns and no-tool synthesis/recovery turns must not inherit a tool-loop or reasoning-only capability; they should resolve a compatible conversational model unless the user explicitly requests analysis, tools, or evidence.

**Why:** A forensic tool-loop model advertised `tool_calling` but not `chat`; reusing it for JSON synthesis/recovery caused capability mismatches, unnecessary fallback pressure, and could open the provider circuit for a local configuration error.

**How to apply:** Keep reasoning requirements scoped to analysis, review, workflow, and execution profiles. When transitioning from tools to no-tools on OpenRouter, clear the pinned model and request `chat`; do not count capability/configuration mismatches as provider-health failures. Add a regression test whenever capability handoff or chat quality hints change.