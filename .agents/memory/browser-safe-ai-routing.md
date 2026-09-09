---
name: Browser-safe AI routing
description: Keep client-visible intent helpers isolated from the Node-heavy orchestrator entrypoint.
---

Routing helpers used by the dashboard must live in a browser-safe module or package subpath. Importing the orchestrator root from client code can pull Node-only dependencies such as node:crypto into Vite and break the runtime overlay.

**Why:** A scan-command UI guard initially imported the orchestrator root; TypeScript passed, but the browser failed before rendering because the package graph included node:crypto.

**How to apply:** Export narrow client-safe detectors through dedicated subpaths and import those from the dashboard. Keep the server’s authoritative resolver separate and test both against the same command contract.