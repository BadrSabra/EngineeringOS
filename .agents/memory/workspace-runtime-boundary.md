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

During recovery, the durable worker/lease claim is written before listener ownership and supervisor adoption are verified; a claimed row alone is not proof that adoption completed. To prove takeover after worker death, seed an expired row before startup, wait until full `src/index.ts` recovery completes, observe the actual worker ID and active lease, kill that API, then wait for the recorded lease to expire naturally before starting the replacement.

**Why:** API worker IDs are process-local; rows inserted after startup may only be claimed by a later sweep, and `recover()` persists its claim before it verifies adoption. Updating the database to force expiry skips the timing behavior that recovery is supposed to validate. Managed supervisor behavior is a separate boundary from API orchestration.

**How to apply:** Wait for the exact supervisor request and for API startup health after recovery, then reload the durable row before asserting ownership. Bind the post-kill expiry check to the captured lease and wait it out without mutating the row. State when the initial stale lease is fixture-seeded. Redirect only the isolated child API's supervisor calls to a loopback fixture.