---
name: Runtime test egress guard
description: Enforce local-only networking inside project runtime test subprocesses.
---

Load the test-only egress guard in the project runtime's own fixed development command; API-process network guards or `NODE_OPTIONS` are not proof that a separately supervised runtime is covered. When patching Node built-ins used by ESM imports, synchronize the named exports as well as the default module object. Node guards are defense in depth only: do not start an API/Playwright lifecycle run unless the host provides verified process-tree egress isolation.

**Why:** The runtime supervisor starts a child with a deliberately restricted environment, so API-local fixtures do not automatically protect the project runtime. Node's ESM built-in named exports can retain the original functions after a default-export monkeypatch unless synchronized.

**How to apply:** Keep the guard scoped to disposable local fixtures, reject external DNS/socket/HTTP/process paths before network access, allow only explicit loopback binding, and test the guard in a subprocess without contacting external hosts. Check current Replit documentation and runtime capability before a full lifecycle run; if OS-level egress isolation is unavailable, stop before API or browser startup and report the exact blocker.
