---
name: Capability probe tool-choice parity
description: Capability Probe preflight and actual tool-loop calls must share an explicit provider tool-choice policy.
---

Capability Probe requests must make the first tool-enabled call explicit (`required`) and later tool-enabled calls explicit (`auto`); synthesis calls must omit tools and tool choice. Preflight success is not proof of actual-call parity.

**Why:** A live Groq run passed a generic preflight but the actual request was interpreted as `tool_choice=none` while the model emitted `read_file`, causing a 400 before any source evidence was collected.

**How to apply:** Keep preflight inputs aligned with the effective read-only manifest and capture tool names, tool choice, response format, and phase in contract telemetry. A provider health success is not an actual-request contract acceptance; the wire request needs a captured contract assertion.

Capability Probe prefetch completion must enter an explicit no-tool synthesis phase before the provider call; merely hiding tools while retaining a prompt that asks for reads causes the model to emit a tool call against `tool_choice=none`.

**Why:** A live trace showed complete server-prefetched bodies, an empty provider tool list, and JSON synthesis mode in the same call, followed by Groq rejecting a model-emitted `read_file` call.

**How to apply:** When complete evidence is already retained, add a server-owned synthesis instruction and force synthesis-only mode. Keep failed pre-first-read executions non-resumable so their identity cannot be replayed as a successful report.

Recovery fallback models must be resolved per provider, and preflight-failed providers must not re-enter the same probe's citation recovery.

**Why:** A recovery trace passed an OpenRouter model slug to Gemini, producing a provider-side 404 and consuming the bounded recovery window before all claim groups completed.

**How to apply:** Build recovery candidates only from providers that passed the current preflight and resolve each candidate's model from its own provider registry.