# Threat Model

## Project Overview

EngineeringOS is a React/Vite dashboard with a TypeScript/Express API, Clerk
authentication, PostgreSQL, and server-side integrations. The current Preview
source contains an AWS-oriented static Vite/React Builder, Attestor, receipt
verification, session/ticket storage, and a static Runtime; these components
have local contract tests but are not deployed as a complete user-facing
Preview service. Managed Node.js/Express Preview is proposed, not implemented
or supported.

## Assets

- **Project source and Candidate revisions** — user code and change evidence;
  unauthorized disclosure or substitution breaks trust in review and delivery.
- **Identity, session, and authorization state** — Clerk identities and
  server-side project ownership determine which user may act on a Candidate.
- **Database records and evidence** — PostgreSQL contains project, proposal,
  session, receipt, and one-time preview-ticket bindings.
- **Signing and integration credentials** — session, AI-provider, GitHub, and
  future Preview signing credentials must remain server-side and out of
  Candidate build environments.
- **Build artifacts and preview tickets** — artifacts can execute in a
  visitor's browser; tickets and signed object URLs are short-lived capabilities
  and must not be logged or disclosed.
- **Candidate-controlled Backend code** — if enabled later, this code is
  untrusted even when produced by the AI Agent. It must not inherit host files,
  application credentials, provider credentials, or internal network access.
- **Runtime host and sandbox control** — container/runtime control sockets,
  process identities, resource quotas, and the exposure channel could grant
  host authority if mounted or shared too broadly.

## Trust Boundaries

- **Browser to API** — the client is untrusted; project, Candidate, session,
  and ticket ownership must be checked server-side.
- **API to PostgreSQL** — durable ownership, revision, session, and ticket
  bindings are authoritative; UI state and worker memory are not.
- **API to external providers** — provider responses and repository content are
  untrusted data; secrets remain server-side.
- **API to Preview Gateway** — control commands require short-lived signatures;
  the Gateway must not receive PostgreSQL credentials.
- **Gateway to build/runtime tasks and S3** — Candidate bytes cross into
  isolated tasks through narrowly scoped, short-lived object capabilities.
  Candidate tasks must have no AWS task role or Internet route.
- **Candidate to Backend sandbox (proposed)** — Candidate code is arbitrary
  execution, not trusted application logic. It must run from a bound immutable
  artifact under an independently qualified sandbox. `WorkspaceRuntime`,
  `projectRoot`, the API process, Docker sockets, and host networking are not
  acceptable substitutes; any session channel must be narrowly scoped and
  cannot grant general host filesystem or service access.
- **Sandbox to Preview exposure path (proposed)** — the Gateway may reach only
  the session-bound service through a constrained channel. The Candidate must
  not choose its upstream, reach the Gateway control plane, or access other
  sessions. A no-network container proves egress denial but also prevents
  Gateway ingress; the transport design must satisfy both properties.
- **Static Preview to visitor browser** — output is untrusted web content. It
  must be served on an isolated origin with restrictive browser policy and no
  application cookies or credentials.

## Scan Anchors

- API and authorization: `artifacts/api-server/src/routes/`,
  `artifacts/api-server/src/lib/`
- Preview contracts and AWS adapters:
  `artifacts/api-server/src/lib/preview-*`,
  `artifacts/api-server/src/preview-gateway.ts`
- Preview infrastructure and static runtime: `infra/aws-preview/`
- Dashboard client: `artifacts/dashboard/src/`
- Terraform templates are local-only until explicitly enabled and deployed.

## Threat Categories

### Spoofing

Forged build results or control requests could start a task for the wrong
Candidate or grant access to another user's Preview. Signed control messages,
authenticated project ownership, and receipts bound to the exact project,
operation, Candidate revision, source root, input digest, output digest, and
fixed builder image are required. The Builder validates a server-provided
short-lived Ed25519 build job before S3 access and derives its expected binding
from those signed claims. Independent Attestor and receipt-verification source
and tests exist, but they do not prove that a deployed AWS task ran or make
Preview a complete user journey. The Gateway launch contract validates the fixed Builder Task
Definition, its exact image and static verifier key, then atomically claims the
job ID. A retry resumes only after a strong read confirms the identical job and
launch fingerprint, the existing envelope metadata matches, and the same ECS
client token and request parameters are reused. This can resolve an ambiguous
launch response without authorizing another task, but there is no complete
deployed Preview service or live Runtime.

### Tampering

Candidate files, S3 objects, or task parameters could be replaced between
review, build, and display. The local Builder source validates the manifest,
source-root binding, every input file digest, and exact S3 object key; it emits
a bounded USTAR/Gzip artifact and uses a conditional one-time output upload.
The Builder/Attestor/Verifier source is not deployed as a complete service, so
AWS-side task identity and live end-to-end receipt acceptance remain
unverified. The DynamoDB claim permits only an exact,
fingerprint-matched retry with the same ECS client token; it does not provide a
background reconciler or authorize a fresh task after an ambiguous launch.

### Information Disclosure

Candidate source, private project files, application credentials, or signed
URLs could leak through task roles, environment dumps, logs, or preview
responses. Build tasks must receive no application secrets, database
credentials, Git credentials, or AWS task role. Signed URLs must be scoped to
one object, expire quickly, and never appear in logs or browser-visible API
responses. Gateway accepts only the signed build token, derives and signs the
transfer URLs itself, and stores the token plus URLs in a unique SSE-S3
environment file under a dedicated S3 prefix. The ECS RunTask override carries
only that file's ARN, not the sensitive values. Only the Builder execution role
can read the prefix for ECS environment-file injection; the task itself has no
task role. The environment file is retained by a one-day lifecycle rule, while
the token and URLs expire sooner. This limits exposure but does not eliminate
the need to protect AWS operator access and avoid logging the envelope content.

### Denial of Service

Compressed archives, oversized files, pathological builds, and excessive
sessions could consume storage, memory, CPU, or AWS budget. Enforce compressed
and expanded byte limits, file-count limits, task CPU/memory/time limits,
per-user concurrency limits, session TTL, and bounded S3 retention before
enabling the service.

### Elevation of Privilege

Candidate build scripts or tool configuration could execute with Gateway,
database, or cloud permissions. The local Builder uses a fixed Vite command and
configuration, a pinned dependency allowlist, an explicit server-selected
source root, and no Candidate lifecycle scripts or dependency installation.
Before deployment, its task must also have no task role, no Internet route, no
secret-bearing environment, and no Candidate-controlled image, command,
entrypoint, or Task Definition.

The existing `WorkspaceRuntime` is a project development runner that launches
`pnpm run dev` from the live project root. It is not a Candidate sandbox and
must not be repurposed for Backend Preview. A Node-level egress guard or
child-process allowlist is defense in depth, not an OS security boundary.
Backend execution remains blocked until the runtime image, filesystem/network
isolation, process/resource limits, and session-bound Gateway channel are
qualified together.

## Proposed Backend Preview Gate

No Candidate-controlled Node.js/Express process may run on the API host or in
the live Workspace process tree. A runtime image or isolated-container probe
alone does not close this gate: the probe must be tied to an immutable
Candidate, deny host mounts and credentials, enforce resource and process
limits, and expose only the intended session through a Gateway-controlled
channel. Standard OCI containers share the host kernel; their assurance must
not be described as VM-level or hardware-backed isolation.

The initial local Docker qualification on 2026-11-12 verified a non-root
container, a distinct network namespace, loopback-only process-visible
interfaces, no IPv4 routes, IPv6 unsupported by the local namespace probe,
read-only root filesystem, dropped capabilities, `no-new-privileges`, and
bounded CPU/memory/PIDs. A separate harmless HTTP probe succeeded through one
per-session Unix-domain-socket mount while `--network none` and no TCP ports
were configured. Both probes used the existing Builder image; neither executed
Candidate code, integrated the product Gateway, or qualified a Backend Runtime
image. The UDS path remains an unapproved feasibility result until its
ownership, race, cross-session, and cleanup properties are proven. Standard
`runc` also shares the host kernel. Therefore this is not authorization to
enable Backend Preview.
