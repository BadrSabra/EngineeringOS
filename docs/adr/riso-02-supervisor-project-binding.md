# RISO-02 — Supervisor Project/Root Binding

## Status

Implementation candidate on the stacked RISO-02 branch. It must not be treated as an OS sandbox qualification or as permission to run untrusted Backend Candidates.

## Trust boundary

The API Control Plane is the authority that resolves a project from the authenticated request and obtains its canonical persisted project root. The Workspace Runtime Manager carries that trusted identity to the local Supervisor.

The Supervisor receives two distinct identifiers:

- `projectId`: the runtime key used for Supervisor session ownership. This may be a server-created namespace such as a Strategy Replay runtime.
- `ownerProjectId`: the real project identity that owns that runtime.

For mutating commands (`start`, `adopt`, and `stop`), the request body also carries the canonical `projectRoot`.

## Signed command envelope

Every POST request to the Supervisor is signed over the exact raw request body and route path using HMAC-SHA256 with the server's `SESSION_SECRET`, under the domain-separated context:

```text
EngineeringOS/workspace-runtime-supervisor/project-binding/v1
```

The Supervisor verifies the command signature before parsing or dispatching the body. This prevents the body or operation path from being changed independently of the API-issued command. The existing Bearer service authentication remains required as a separate check.

The signature binds the runtime key, owner project ID, session ID, operation path, and (for start/adopt/stop) the project root carried by that command.

## Supervisor enforcement

- The Supervisor requires syntactically valid runtime and owner project IDs.
- `start` and `adopt` canonicalize the root, require it to be inside the configured workspace-root allowlist, and bind the session record to both `ownerProjectId` and the canonical root.
- An existing runtime key cannot be reused with a different owner or root, even when the prior session is not currently active.
- `stop` must match the tracked owner, session, and canonical root.
- `observe-start` must name the same owner as any tracked runtime session and returns the owner identity so the API client can verify it.
- A runtime namespace preserves the distinction between the actual owning project and a synthetic runtime ID. This is needed by isolated Strategy Replay workspaces.
- The local Replit Supervisor allowlist includes the project workspace and `/tmp`, because validation workspaces are created beneath the host temporary directory. The API signature—not path membership alone—authorizes which project/runtime may use a particular allowed root.

## Security properties and limitations

This is an API-issued, symmetric command authorization proof. It binds an authorized API command to a specific runtime identity and canonical project root. The Supervisor does **not** independently query PostgreSQL; it trusts the HMAC authority held by the API Control Plane.

The HMAC key is currently derived from the shared `SESSION_SECRET` with domain separation. Consequently, this change does not eliminate the separate RISO-00/RISO-01 risks of a Candidate running under the same OS identity or obtaining service secrets through host-level process inspection. A host-level UID separation and protected control channel remain mandatory.

This change also does not add a durable replay ledger, nonce/fencing generation, PID namespace, filesystem namespace, network namespace, cgroups, gVisor, microVM, or Backend Candidate execution admission. Retries are constrained by the existing session identity and owner/root match; persistent replay/fencing remains a separate qualification item.

## Required verification

- Reject a mutated body with an old signature.
- Reject start with a different owner for an existing runtime key.
- Reject start with a different root for the same owner/runtime key.
- Reject adopt, stop, and observation when the owner does not match.
- Preserve the original process after a wrong-owner stop attempt.
- Preserve owner binding through API worker recovery, Supervisor adoption, heartbeat adoption, and stop.
- Run the Supervisor server tests, Workspace Runtime unit/lifecycle tests, PostgreSQL recovery tests, typecheck, and full CI.
