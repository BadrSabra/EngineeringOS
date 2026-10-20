---
name: Package test root
description: Run Vitest from the owning package to avoid stale generated project copies.
---

Vitest checks for a package must run from that package's directory, not the workspace root.

**Why:** The workspace can contain generated or imported project copies with similarly named tests. Validation runs may materialize copies under `.engineeringos-delivery`; root-level discovery can then run several copies together, causing misleading failures and shared-fixture collisions.

**How to apply:** Use the owning package directory for focused or serialized Vitest runs, such as `artifacts/api-server` or `lib/ai-orchestrator`. Use package-filtered typechecks for compiler validation.

Pinned benchmark source clones need an available `node_modules` tree: the benchmark runner links `sourceRoot/node_modules` into its disposable candidate, and registered validation overlays reuse that tree. Without it, `pnpm exec vitest run` may fail before loading tests with `ERR_MODULE_NOT_FOUND`; a `vitest --version` probe alone does not verify the suite.

**Why:** A missing dependency tree initially surfaced as a generic pnpm failure, while a version-only probe did not reveal suite-level baseline failures.

**How to apply:** Before a pinned live run, ensure the temporary source root has dependencies compatible with its lockfile, run the exact registered validation profile on the clean baseline, and distinguish module-load failures from test assertion failures.

Vitest may resolve an optional Vite peer to a newer major than the workspace's Vite catalog, even when the dashboard itself uses the catalog version. This can split the React JSX transform from Vitest and produce an import-analysis JSX parse error while typechecking succeeds.

**Why:** A dependency re-resolution selected Vite 8 for Vitest while the app and React plugin used Vite 7; the JSX parser error disappeared when the peer was forced onto the workspace's Vite major.

**How to apply:** If Vitest reports invalid JSX during import analysis, inspect `pnpm why vite` and the lockfile peer context before changing TSX. Keep Vitest's Vite peer aligned with the app's supported major.