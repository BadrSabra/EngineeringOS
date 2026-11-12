# Threat Model

## Project Overview

EngineeringOS is a React/Vite dashboard with a TypeScript/Express API, Clerk
authentication, PostgreSQL, and server-side integrations. The planned Preview
flow builds a static Vite/React Candidate in an isolated AWS task, stores a
bounded artifact in private S3, and serves it from a separate static runtime.
The Builder source and local container recipe exist, but the AWS foundation and
Preview services are not deployed.

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
from those signed claims. This does not prove which ECS image ran or prevent
replay by itself. The Gateway launch contract validates the fixed Builder Task
Definition, its exact image and static verifier key, then atomically claims the
job ID. A retry resumes only after a strong read confirms the identical job and
launch fingerprint, the existing envelope metadata matches, and the same ECS
client token and request parameters are reused. This can resolve an ambiguous
launch response without authorizing another task, but there is no background
reconciler or independent output attestation yet. A receipt signer must remain
outside the Candidate-executing task and is not implemented.

### Tampering

Candidate files, S3 objects, or task parameters could be replaced between
review, build, and display. The local Builder source validates the manifest,
source-root binding, every input file digest, and exact S3 object key; it emits
a bounded USTAR/Gzip artifact and uses a conditional one-time output upload.
The Builder is not deployed, and AWS-side task identity plus receipt
attestation remain outstanding. The DynamoDB claim permits only an exact,
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
