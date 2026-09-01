---
name: Gemini structured output
description: Compatibility constraint for Gemini's OpenAI-compatible chat endpoint.
---

Gemini's OpenAI-compatible chat endpoint accepts the standard `response_format: { type: "json_object" }` request field for structured output, but does not accept OpenAI tool payloads. Tool-capable calls must use Google's native `generateContent` function-calling schema; no-tool JSON calls should stay on the compatible endpoint.

**Why:** Prompt-only JSON requests can return malformed or truncated review output even when transport and authentication succeed; stripping response format hides a supported provider capability.

**How to apply:** Preserve response-format hints for no-tool Gemini structured agents. For tool calls, translate messages, function declarations, tool choice, and function responses to the native Gemini request/response shape, then normalize returned calls through the shared manifest validator. A live request can still be blocked by the account's provider quota even when the transport is correct.