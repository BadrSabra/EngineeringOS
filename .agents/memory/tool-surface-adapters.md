---
name: Tool surface adapters
description: External tool families must remain gated until a real server-owned adapter exists.
---

The provider-facing tool manifest may expose only capabilities with a concrete server adapter. Database, object storage, integrations, external APIs, deployment/log access, package management, and binary readers stay catalogued but hidden until their adapter can enforce authorization, tracing, resume, revision binding, and post-use verification.

**Why:** Exposing placeholder tool names would let provider output imply capabilities that the server cannot safely execute or verify.

**How to apply:** Extend the existing tool policy and executeSingleTool seams; do not create a parallel dispatcher or pass credentials and arbitrary commands through model arguments.