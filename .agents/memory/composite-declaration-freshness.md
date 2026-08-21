---
name: Composite declaration freshness
description: TypeScript composite projects can retain build metadata while ignored declaration outputs are missing or stale.
---

Referenced composite libraries must be rebuilt with forced emission before a consumer-only API typecheck when their declaration output is ignored or otherwise disposable.

**Why:** TypeScript can use a surviving `.tsbuildinfo` file to treat a project as up to date even after its declaration files were cleaned, causing the consumer to see missing or outdated exports and fields.

**How to apply:** Keep the consumer's dependency-build step explicit and forced, then run the consumer's `--noEmit` check against those regenerated declarations.