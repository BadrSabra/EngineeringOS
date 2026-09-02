---
name: Browser stream abort fixtures
description: How to model a mid-stream transport failure in Playwright without relying on route EOF behavior.
---

Playwright route fulfillment ending after an SSE event is a clean EOF, not a rejected browser stream. For network-error recovery coverage, wrap the response body in a browser `ReadableStream`, deliver the durable identity frame, yield once so Chromium can consume it, then call `controller.error(...)`. A paused recovery fixture should expose only pre-resume history; the resumed `done` event owns the completed assistant message.

**Why:** The client’s network-error path only runs when the stream reader rejects; a truncated fulfilled body can silently look like a normal completion.

**How to apply:** Use this pattern for browser tests that must prove recovery after a transport interruption while keeping deterministic same-origin routing intact. Register recovery fixtures with session/message routes, but omit their eventual assistant result until resume.