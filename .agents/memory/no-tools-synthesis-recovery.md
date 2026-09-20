---
name: No-tools synthesis recovery
description: Durable rule for malformed provider output during evidence-backed no-tools synthesis.
---

When a no-tools synthesis provider returns executable-looking or otherwise contract-invalid content, keep the parser fail-closed but allow one bounded retry. The transport must send an explicit `tool_choice=none` contract, not merely omit the tools array. For OpenRouter, exclude every model observed in the failed attempt and use an explicit plain-prose repair instruction; if the retry is not accepted, use the server-owned deterministic evidence fallback. Provider transport/availability failures (including timeout, rate-limit, empty, and invalid-provider responses) must not trigger another repair; only a provider `INVALID_TOOL_CALL` or a semantically incomplete candidate may consume the single repair attempt. Preserve the first public fallback reason and expose the bounded failure chain only in the existing diagnostic.

**Why:** A provider can return HTTP 200 while violating the no-tools protocol, including hallucinating an executable tool call when the request has no tools. Treating that as a successful synthesis is unsafe, while immediately falling back wastes an available alternate model and hides the phase where the failure occurred. Retrying a transport failure after the proof lane is complete only adds latency and can obscure the original failure.

**How to apply:** Keep the retry request- and ledger-bounded, close every admitted recovery event as completed or failed, attribute provider attempts to `project_query_no_tools_synthesis`, preserve the first fallback reason across later failures, and never execute or reinterpret provider-emitted tool syntax.