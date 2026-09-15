---
name: Package test root
description: Run Vitest from the owning package to avoid stale generated project copies.
---

Vitest checks for a package must run from that package's directory, not the workspace root.

**Why:** The workspace can contain generated or imported project copies with similarly named tests; root-level discovery can run several copies together, causing misleading failures and shared-fixture collisions.

**How to apply:** Use the owning package directory for focused or serialized Vitest runs, such as `artifacts/api-server` or `lib/ai-orchestrator`. Use package-filtered typechecks for compiler validation.