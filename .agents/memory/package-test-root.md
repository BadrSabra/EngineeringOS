---
name: Package test root
description: Run API Vitest from the artifact package directory to avoid discovering a nested imported-project copy.
---

The API test command must run with `artifacts/api-server` as the working directory. Running Vitest from the workspace root can discover the stale `.engineeringos-projects` copy instead of the active artifact and produce misleading failures.

**Why:** The workspace contains an imported-project directory with a second copy of similarly named tests; root-level Vitest discovery selected that copy during validation.

**How to apply:** Use `cd artifacts/api-server && pnpm exec vitest ...` for focused or serialized API test runs. Use the package-filtered typecheck for compiler validation.