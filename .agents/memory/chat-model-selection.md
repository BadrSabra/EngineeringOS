---
name: Chat model selection
description: Model capability requirements for ordinary conversational turns
---

Ordinary `CHAT` turns, read-only `tool_chat` turns, and no-tool synthesis/recovery turns must not inherit a reasoning-only capability; they should resolve a compatible conversational model unless the user explicitly requests analysis, tools, or evidence. When synthesis follows a tool loop, reuse the actual last successful model and carry its identity through terminal tool failures, but never through a terminal provider failure.

**Why:** A forensic tool-loop model advertised `tool_calling` but not `chat`; reusing it for JSON synthesis/recovery or a read-only project query caused capability mismatches, unnecessary fallback pressure, and could open the provider circuit for a local configuration error. Separately, a tool can fail after its provider response succeeds, so dropping that response's model identity needlessly restarts synthesis at the catalog head.

**How to apply:** Keep reasoning requirements scoped to analysis, review, workflow, and execution profiles. When transitioning from tools to no-tools on OpenRouter, pin the actual successful model through response, incomplete, and tool-failure results; keep it absent after provider failure, including a 429 without positive `Retry-After`. Treat model-contract failures such as empty output or invalid tool calls as candidate failures, not provider-health failures. Add a regression test whenever capability handoff or chat quality hints change.