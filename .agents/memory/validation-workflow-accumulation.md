---
name: Validation workflow accumulation
description: Environment guidance for stale generated validation workflows that interfere with normal artifact services.
---

Generated `.engineeringos-delivery/...` validation workflows can remain registered or running after a validation campaign. They may consume process/thread slots, collide with the real artifact ports, and cause unrelated pnpm, Vite, esbuild, or Node startup failures.

**Why:** During imported-project startup, the application failures were initially masked by missing dependencies and then by resource exhaustion from stale validation copies. Stopping only the stale generated workflows restored reliable startup while preserving the real artifact services.

**How to apply:** Before retrying a failed setup or restart, inspect workflow state and stop only running `.engineeringos-delivery/...` copies. Leave `artifacts/...` services running; do not replace their managed workflows.