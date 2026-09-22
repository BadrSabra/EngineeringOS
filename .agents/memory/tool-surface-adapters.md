---
name: Tool surface adapters
description: External tool families must remain gated until a real server-owned adapter exists.
---

The provider-facing tool manifest may expose only capabilities with a concrete server adapter. Database, object storage, integrations, external APIs, deployment/log access, package management, and binary readers stay catalogued but hidden until their adapter can enforce authorization, tracing, resume, revision binding, and post-use verification. External side-effect capabilities must additionally receive a server-owned runner and the durable operation identity bound to the evidence that authorizes the effect; model input never supplies the remote, credentials, proposal, or execution controls.

**Why:** Exposing placeholder tool names would let provider output imply capabilities that the server cannot safely execute or verify. A generic external action can otherwise bypass the proposal/commit boundary or become detached from durable idempotency and recovery.

**How to apply:** Extend the existing capability/recipe seams; do not create a parallel dispatcher or pass credentials, remotes, proposals, or arbitrary commands through model arguments. For an external mutation, bind the recipe operation to the server-owned proposal/commit evidence and return a server-verified integration receipt. Non-text inspection must read bounded headers and stream hashes rather than loading large files into memory.