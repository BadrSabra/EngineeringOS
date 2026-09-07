---
name: Capability probe tool-choice parity
description: Capability Probe preflight and actual tool-loop calls must share an explicit provider tool-choice policy.
---

Capability Probe requests must make the first tool-enabled call explicit (`required`) and later tool-enabled calls explicit (`auto`); synthesis calls must omit tools and tool choice.

**Why:** A live Groq run passed a generic preflight but the actual request was interpreted as `tool_choice=none` while the model emitted `read_file`, causing a 400 before any source evidence was collected.

**How to apply:** Keep preflight inputs aligned with the effective read-only manifest and capture tool names, tool choice, response format, and phase in contract telemetry. A provider health success is not an actual-request contract acceptance.