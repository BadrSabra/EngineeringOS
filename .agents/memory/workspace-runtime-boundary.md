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

API-to-supervisor control requests require a domain-separated HMAC derived from the shared `SESSION_SECRET`; the supervisor rejects non-loopback binding and only signals sessions it owns.

**Why:** The API and supervisor run as separate workflows, so a loopback listener alone does not authenticate callers; using the existing shared secret avoids adding a second credential.

**How to apply:** Derive the same scoped token in both processes, never expose it to child project processes or logs, keep project-root authorization in the API, and make the supervisor independently reject noncanonical roots and unowned process identities.

During recovery, the durable worker/lease claim is written before listener ownership and supervisor adoption are verified; a claimed row alone is not proof that adoption completed. To prove takeover after worker death, seed an expired row before startup, wait until full `src/index.ts` recovery completes, observe the actual worker ID and active lease, kill that API, then wait for the recorded lease to expire naturally before starting the replacement.

**Why:** API worker IDs are process-local; rows inserted after startup may only be claimed by a later sweep, and `recover()` persists its claim before it verifies adoption. Updating the database to force expiry skips the timing behavior that recovery is supposed to validate. Managed supervisor behavior is a separate boundary from API orchestration.

**How to apply:** Wait for the exact supervisor request and for API startup health after recovery, then reload the durable row before asserting ownership. Bind the post-kill expiry check to the captured lease and wait it out without mutating the row. State when the initial stale lease is fixture-seeded. Redirect only the isolated child API's supervisor calls to a loopback fixture.

Runtime startup must renew its durable lease before and throughout environment capture and supervisor startup. If the supervisor response is ambiguous, retain the exact starting session identity until a complete observation can confirm that session is running or definitively absent.

**Why:** The supervisor may create a process while its HTTP response is lost, and a lease can expire during startup; marking either case failed can orphan a live process or let recovery replace its owner.

**How to apply:** Serialize starts per project at both manager and supervisor boundaries, retry only with the same session ID, reconcile from supervisor inventory, and preserve unresolved rows for later reconciliation.

### Process-group termination

A managed runtime is not stopped merely because its group leader exited. Wait for the owned process group to disappear, escalate from SIGTERM to SIGKILL while any member remains, and keep the stop result explicitly failed or unresolved if group disappearance cannot be confirmed.

**Why:** The leader can exit on SIGTERM while a descendant in the same group ignores it; reporting `stopped` at that point leaves an orphaned runtime and false lifecycle state.

**How to apply:** Use group-level liveness rather than leader-PID liveness, and test with a leader that exits on SIGTERM while a ready descendant ignores it. Keep status observations unresolved until cleanup is confirmed.


### Destructive project deletion

Project deletion and database-backed runtime startup use the same PostgreSQL session advisory-lock namespace and runtime identity. Deletion holds that lock across active-work checks, confirmed runtime shutdown, the project/audit transaction, and managed-root cleanup. Lock contention or a shutdown result that is not explicitly `stopped` with `pid: null` blocks deletion; a runtime owned by another live worker is not force-stopped. When the durable runtime row is absent and the Supervisor is configured, deletion may proceed only after a complete empty inventory with no unknown managed listeners. The inventory request must carry the registered owner project ID and canonical project root, and both values in the returned observation must match exactly before it can prove a stopped state.

A recovery row with a missing source revision cannot be bound to a valid Supervisor state version. Release the recovery claim and leave the row retryable; do not invent a revision, adopt the process, or issue an unbound Supervisor stop.

### Runtime observation scope

A live session corroborated by its owned process identity and expected listener remains `running` even when unrelated managed-range listeners have unknown owners. Unknown listeners still prevent a `stopped` claim when the target has no corroborated live session.

**Why:** Applying a global incomplete-port inventory to a positively identified session lets another project's listener incorrectly make that session unavailable.

**How to apply:** First bind the target session to its direct owned PID and expected port; use unowned listeners to constrain only absent or uncorroborated target states, never to erase positive target-specific proof.