---
name: Safe terminal execution boundary
description: Terminal actions are selected by server-owned fixed command profiles, never by model-provided shell text.
---

The terminal tool must accept only a registered profile whose executable, argv, timeout, output cap, and scope are owned by the server. The model may select a profile but cannot supply a shell command, interpolation, cwd escape, or arbitrary arguments.

**Why:** A tool definition is only an advisory provider boundary; enforcement must remain effective if a model emits unexpected arguments or a provider is retried.

**How to apply:** Route approved profiles through the bounded non-shell kernel, keep write approval separate, and expose only bounded/redacted status and summaries to users.