---
name: Workspace runtime boundary
description: Runtime ownership rules for project previews versus Replit-managed artifact workflows.
---

The application runtime may supervise explicitly profiled processes owned by a user project, but it must not replace, duplicate, or claim control over Replit-managed artifact workflows.

**Why:** The API process cannot safely restart the process that owns it, and artifact workflows receive platform-managed routing and lifecycle configuration that an application-level replacement would not preserve.

**How to apply:** Keep project runtime controls server-owned and bounded; use a separate supervisor for durable multi-service ownership, while treating EngineeringOS artifact workflows as external platform-owned services.

Project runtime ownership is durable in PostgreSQL, not in the API heap: a worker holds a short lease and heartbeat, releases ownership without killing a detached preview during graceful replacement, and a later worker adopts only when the recorded PID and port are reachable.

**Why:** API workers are replaceable, while a project preview may legitimately outlive one worker; lease-qualified adoption prevents two workers from controlling the same process.

**How to apply:** Every runtime mutation must be conditional on the current worker lease, and recovery must mark unreachable rows failed rather than inventing a new process identity.

The internal runtime supervisor is a local control service, not a preview artifact: its workflow must not wait for or expose a forwarded port, and the API heartbeat must re-adopt the managed PID after supervisor replacement.

**Why:** Replit workflow port detection can fail for an intentionally localhost-only control service, while supervisor replacement otherwise loses its in-memory child registry.

**How to apply:** Keep the supervisor bound to loopback with no `waitForPort`; use heartbeat adoption plus durable PID/port state for recovery.

During recovery, the durable worker/lease claim is written before listener ownership and supervisor adoption are verified; a claimed row alone is not proof that adoption completed. Startup fixtures that synthesize the old worker ID or expire its lease directly prove startup orchestration, not that the killed API actually held that lease or that the managed supervisor adopted the process.

**Why:** The claim is an intermediate recovery state, while API worker IDs are process-local and a local supervisor HTTP fixture cannot establish behavior of the managed supervisor.

**How to apply:** Wait for the exact supervisor request and reload the final durable row before asserting adoption. State when worker identity or lease expiry is fixture-seeded; stronger ownership proof must observe the actual API worker ID and lease before killing it. Redirect only the isolated child API's supervisor calls to a loopback fixture.