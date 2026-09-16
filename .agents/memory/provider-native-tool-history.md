---
name: Provider-native tool history
description: Provider-specific metadata that is required to replay tool calls must survive the shared normalized conversation representation.
---

When a provider requires metadata on assistant tool-call parts, the provider adapter must preserve that metadata across response normalization and subsequent request history. A generic ToolCall shape that keeps only name, arguments, and id is not sufficient for every provider.

**Why:** A Gemini tool response can be HTTP-successful and still make the next tool turn fail if its thought signature is dropped before replay. This converts a recoverable provider handoff into a terminal fallback failure.

**How to apply:** Treat provider-native tool-call metadata as part of the replay contract. Add a regression test that performs at least two tool iterations and asserts the second provider request contains the original required metadata; do not expose the metadata in user-facing traces.