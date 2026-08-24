---
name: Dashboard process campaign
description: Release browser campaigns can coordinate real child-process restarts through a bounded localhost control surface.
---

The browser campaign should keep the dashboard process and multiple browser sessions alive while the release runner owns API stop/start and health recovery through a localhost-only, bounded control surface.

**Why:** Browser-only request interception cannot prove that persisted UI state converges after a real API process restart.

**How to apply:** Keep restart orchestration in the release runner, expose only narrowly scoped test controls, await listener binding and API health, and retain restarted process groups for teardown diagnostics.