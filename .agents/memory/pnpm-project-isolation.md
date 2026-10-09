---
name: Nested pnpm project isolation
description: pnpm workspace discovery for generated project roots inside the EngineeringOS workspace.
---

A standalone project beneath the repository root inherits the root `pnpm-workspace.yaml`. If its path is not included by the workspace globs, a normal install can report "No projects found" instead of installing it independently. An offline probe with `--ignore-workspace` advanced to package metadata resolution.

**Why:** Generated projects live under managed workspace storage but are intentionally not EngineeringOS workspace members; relying on default pnpm scope can silently skip dependency installation.

**How to apply:** Use a server-owned, tested install command with explicit workspace isolation and the template's fixed lockfile. Never add user project roots to the EngineeringOS workspace globs dynamically.
