---
name: Gemini structured output
description: Compatibility constraint for Gemini's OpenAI-compatible chat endpoint.
---

Gemini's OpenAI-compatible chat endpoint accepts the standard `response_format: { type: "json_object" }` request field for structured output, but does not accept OpenAI tool payloads in this adapter.

**Why:** Prompt-only JSON requests can return malformed or truncated review output even when transport and authentication succeed; stripping response format hides a supported provider capability.

**How to apply:** Preserve response-format hints for Gemini structured agents and remove only tools/tool-choice fields before sending the request.