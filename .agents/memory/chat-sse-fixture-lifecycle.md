---
name: Chat SSE fixture lifecycle
description: Durable test-fixture constraints for chat streaming execution registration and cancellation isolation.
---

Chat SSE fixtures must model the durable execution lifecycle at the controller boundary: status-only reads during controller registration need to return a running execution, and every test must clear cancellation markers and terminal fields before starting a new stream.

**Why:** If the fixture hides a running row from controller registration, the route aborts every new stream; if a cancellation marker survives one test, later tests report cancelled outcomes and obscure their actual assertions.

**How to apply:** When changing chat stream lifecycle code or its tests, keep the mock DB's status-only execution lookup faithful to the real query and reset `cancelRequestedAt`, `error`, `checkpoint`, status, and final-message state in `beforeEach`.