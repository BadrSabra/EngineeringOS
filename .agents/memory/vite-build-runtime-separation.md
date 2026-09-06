---
name: Vite build/runtime separation
description: The workspace's browser builds must not depend on workflow variables while runtime commands retain strict configuration checks.
---

Build-only defaults belong behind Vite's `build` command and may include only
non-secret metadata plus an explicitly labeled public-key placeholder. Runtime
`dev` and `preview` commands must continue to require their workflow-provided
port, base path, and real public authentication configuration.

**Why:** Root builds also load browser Vite configs, but workflow variables are
runtime concerns; relaxing the checks globally would hide broken service
startup, while reading server secrets would risk embedding them in `dist`.

**How to apply:** Prefer explicit `BUILD_*` overrides for CI/deployment and
resolve public browser keys from public variables only. Keep server-only
credentials out of Vite `define` values and browser bundle tests.