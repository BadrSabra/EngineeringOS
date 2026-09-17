---
name: OpenRouter correction model binding
description: Bounded JSON correction must prefer the model that produced the preceding response instead of restarting at the catalog head.
---

When a tool-loop response needs bounded JSON correction, keep the actual provider model from that response when it is available. A fresh OpenRouter resolver can choose a different first free model that is temporarily rate-limited, turning a recoverable parser handoff into a terminal failure.

**Why:** The parser failure path previously re-resolved OpenRouter from the catalog head; a rate-limited candidate blocked correction even though the tool-loop model had completed successfully.

**How to apply:** Pass the observed model into correction options for both direct-stream and non-streaming correction. Let the provider strategy re-resolve only when the observed model is stale or lacks the requested chat capability.