---
name: No-tools synthesis recovery
description: Durable rule for malformed provider output during evidence-backed no-tools synthesis.
---

When a no-tools synthesis provider returns executable-looking or otherwise contract-invalid content, keep the parser fail-closed but allow one bounded retry. For OpenRouter, exclude every model observed in the failed attempt and use an explicit plain-prose repair instruction; if the retry is not accepted, use the server-owned deterministic evidence fallback.

**Why:** A provider can return HTTP 200 while violating the no-tools protocol. Treating that as a successful synthesis is unsafe, while immediately falling back wastes an available alternate model and hides the phase where the failure occurred.

**How to apply:** Keep the retry request- and ledger-bounded, close every admitted recovery event as completed or failed, attribute provider attempts to `project_query_no_tools_synthesis`, and never execute or reinterpret provider-emitted tool syntax.