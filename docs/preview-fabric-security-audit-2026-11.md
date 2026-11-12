# Preview Fabric Security Audit

**Started:** 2026-11-12  
**Method:** Read-only code/configuration review plus independent repository scans.  
**Execution boundary:** No Candidate or project-supplied code was run during this audit. No code, configuration, database, cloud resource, or GitHub branch was changed.

## Audit sequence

| Order | Area | Status |
| --- | --- | --- |
| 1 | Runtime isolation and host boundary | Reviewed |
| 2 | Filesystem and Local Agent security | Not started |
| 3 | Secrets, environment, and database isolation | Not started |
| 4 | Candidate-to-Release provenance | Not started |
| 5 | Network, Gateway, and public exposure | Not started |
| 6 | Observability, resource limits, and cost | Not started |

## Repository-wide scanner baseline

The independent scans reported **0 SAST findings**, **40 high / 45 moderate / 11 low dependency findings, with 0 critical**, and **3 low HoundDog findings**. These are repository-wide counts, not proof that each finding is reachable or exploitable. The dependency and logging findings must be mapped to their runtime paths in the relevant audit sections; no dependency changes were made.

## 1. Runtime isolation and host boundary

### Findings

#### RT-01 — Workspace development scripts are not an OS isolation boundary

**Severity:** High for shared or multi-user deployments; conditional on deployment trust model.  
**Confidence:** High from source; cross-user impact depends on how the service is deployed.

The authenticated project owner can start the server-owned `pnpm run dev` profile for a registered project. That command executes the project's `package.json` development script. The child receives an environment allowlist, and the API verifies project ownership and resolves the registered project root, but the spawn path does not assign a separate UID/GID, container, namespace, seccomp profile, filesystem view, or network policy. It therefore runs with the API/supervisor host user's operating-system access. A process in one project can potentially read other files available to that same OS identity; API-level project ownership does not enforce filesystem isolation between processes.

The loopback-only, HMAC-authenticated supervisor, fixed command/profile, `shell: false`, session ownership checks, and process-group shutdown are useful control-plane and lifecycle protections. They do **not** sandbox the project script. The environment allowlist also does not prevent reads from files accessible to the same OS user.

**Boundary:** Treat Workspace Runtime as trusted-owner local development only. It is not a safe execution boundary for mutually untrusted project owners on a shared host and is not evidence that Candidate Preview is isolated.

#### RT-02 — Candidate Preview has no verified stronger-than-runc execution boundary

**Severity:** High readiness blocker for executing untrusted server-side Candidate code.  
**Confidence:** High for the reviewed repository state.

No production-connected Candidate execution path or stronger-than-standard-container runtime (for example, a second-kernel sandbox) was found in the reviewed executable paths. The AWS Preview runtime image is a non-root static-file server for a previously built bundle; it does not execute an arbitrary Candidate server process. The isolated Docker settings in CI apply to test jobs, not to the Workspace Runtime or a deployed Candidate runtime.

**Boundary:** Do not treat a passing Builder test, Dockerfile non-root user, or CI container flags as proof that untrusted Candidate code is safely executable in production. Keep backend Preview blocked until its actual runner boundary and end-to-end restrictions are independently established.

#### RT-03 — Workspace Runtime does not enforce loopback binding for the project server

**Severity:** Medium; actual external reachability is unverified and belongs to audit area 5.  
**Confidence:** High that the application does not enforce the bind address.

The runtime reserves and probes a port through `127.0.0.1`, then starts the project with `PORT` but no server-owned bind-host constraint. Listener ownership checks establish which process owns a port; they do not establish that it is bound only to loopback. A project server may bind a broader interface, subject to the surrounding platform's network policy.

**Boundary:** Do not infer private-only access from loopback port reservation or process ownership. Verify network reachability separately before presenting this runtime as a protected Preview gateway.

### Existing controls observed

- Project runtime routes require authenticated project ownership; mutating operations require write access.
- Project registration canonicalizes roots and applies the workspace path policy.
- The runtime supervisor refuses non-loopback binding and authenticates requests with a derived token.
- Runtime startup uses a fixed server-owned profile, bounded ports and startup time, session/lease ownership, process-tree observation, and process-group termination.
- The child environment is filtered rather than inheriting the API environment wholesale.
- The AWS static runtime image runs as a non-root user; this is defense in depth for the static server, not an untrusted-code sandbox.
- CI smoke containers have explicit no-network, read-only, no-new-privileges, dropped-capability, and CPU/memory/PID limits. Those controls are scoped to CI.

### Closure criteria for area 1

1. State explicitly whether project-supplied development code is trusted and whether one service instance may contain projects owned by different users.
2. If mutually untrusted code is in scope, demonstrate a separately enforced OS boundary for the actual process, including filesystem, credentials, network egress, CPU, memory, process count, and lifetime limits.
3. Prove the runtime listener cannot escape the intended interface boundary, or document and verify the external gateway that enforces it.
4. Keep Candidate execution disabled until the above evidence covers the actual Candidate-to-Preview path rather than a test container or static-file server.

## Evidence reviewed

- `artifacts/api-server/src/routes/runtime.ts`
- `artifacts/api-server/src/middlewares/requireProjectAccess.ts`
- `artifacts/api-server/src/lib/workspace-runtime.ts`
- `artifacts/api-server/src/lib/workspace-runtime-supervisor-client.ts`
- `scripts/workspace-runtime-supervisor.mjs`
- `artifacts/api-server/src/lib/project-root.ts`
- `artifacts/api-server/src/lib/agent-state/runtime-listener-process.ts`
- `infra/aws-preview/runtime/Dockerfile`
- `infra/aws-preview/runtime/server.mjs`
- `.github/workflows/api-only-smoke-isolated.yml`
- `.github/workflows/uxw01-browser-isolated.yml`
