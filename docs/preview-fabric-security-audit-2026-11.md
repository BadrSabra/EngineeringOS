# Preview Fabric Security Audit

**Started:** 2026-11-12

**Method:** Read-only code/configuration review plus independent repository scans.

**Execution boundary:** No Candidate or project-supplied code was run during this audit. No code, configuration, database, cloud resource, or GitHub branch was changed. A read-only process-permission check did not read any environment-file contents or secret values.

## Executive assessment

**Decision: not ready to run mutually untrusted project code on the shared Workspace Runtime host, and not ready to claim a public or end-to-end Candidate Preview.**

The most urgent finding is that project `pnpm run dev` scripts run under the same OS identity as the API and Runtime supervisor. The host permission check confirmed the API/supervisor `/proc/<pid>/environ` files are readable by that identity. The filtered child environment therefore does not protect host-process secrets from untrusted code. This is critical if multiple users or untrusted projects share the host.

The AWS Preview code has substantially stronger source-level boundaries: digest-pinned static artifacts, constrained Builder/Attestor tasks, signed identity-bound receipts, bounded ticket contracts, and private network rules. But the repository documents this as an unapplied foundation, without deployed tasks, a public Gateway, or a real browser journey. Provenance controls are strong between code modules, while Candidate Review → acceptance → apply → delivery is still a product/integration gap. Resource controls for Fargate are bounded, but there is no Preview-wide concurrency/cost budget or cloud alarm in the checked Terraform.

### Recommended order

1. **Contain Workspace Runtime:** do not run untrusted projects on the shared host until a separately enforced OS boundary prevents procfs, filesystem, credential, and network access outside that runtime.
2. **Close archive/resource abuse:** remediate the reachable high-severity ZIP dependency finding and move decompression into bounded isolated work with aggregate admission controls.
3. **Add global quotas and cost alerts:** enforce per-user/project concurrent build/session limits, request budgets, and cloud spend/usage alerts.
4. **Prove deployed Preview:** only after approved deployment, validate the public Gateway, one-time ticket, TLS/Origin policy, live session, stale-Candidate rejection, and cross-project denial.
5. **Finish the release identity chain:** carry the same proposal/operation/Candidate/change-set identifiers through review, acceptance, apply, and delivery without treating Preview evidence as Canonical Proof.

## Audit sequence

| Order | Area | Status |
| --- | --- | --- |
| 1 | Runtime isolation and host boundary | Reviewed |
| 2 | Filesystem and Local Agent security | Reviewed |
| 3 | Secrets, environment, and database isolation | Reviewed |
| 4 | Candidate-to-Release provenance | Reviewed |
| 5 | Network, Gateway, and public exposure | Reviewed |
| 6 | Observability, resource limits, and cost | Reviewed |

## Repository-wide scanner baseline

The independent scans reported **0 SAST findings**, **40 high / 45 moderate / 11 low dependency findings, with 0 critical**, and **3 low HoundDog findings**. These are repository-wide counts, not proof that each finding is reachable or exploitable. The dependency and logging findings must be mapped to their runtime paths in the relevant audit sections; no dependency changes were made.

## 1. Runtime isolation and host boundary

### Findings

#### RT-01 — Workspace development scripts can read host-process environments

**Severity:** Critical for shared or multi-user deployments; high if project code is not fully trusted.

**Confidence:** High for the same-UID and process-environment boundary; actual cross-user exposure depends on deployment trust model.

The authenticated project owner can start the server-owned `pnpm run dev` profile for a registered project. That command executes the project's `package.json` development script. The child receives an environment allowlist, and the API verifies project ownership and resolves the registered project root, but the spawn path does not assign a separate UID/GID, container, namespace, seccomp profile, filesystem view, or network policy. It therefore runs with the API/supervisor host user's operating-system access.

A read-only host check confirmed that the API and supervisor processes use the workspace UID/GID and that their `/proc/<pid>/environ` files are readable by the workspace user. No environment contents or secret values were read. Because the project script runs as that same OS user, filtering its inherited environment does not prevent it from reading sibling host-process environments through procfs. This creates a path to host configuration secrets, in addition to other same-UID files, if untrusted project code can run on a shared instance.

The loopback-only, HMAC-authenticated supervisor, fixed command/profile, `shell: false`, session ownership checks, and process-group shutdown are useful control-plane and lifecycle protections. They do **not** sandbox the project script. The environment allowlist also does not prevent reads from files accessible to the same OS user.

**Boundary:** Treat Workspace Runtime as trusted-owner local development only. Do not run mutually untrusted project code on this shared host boundary. The child environment allowlist is not a substitute for OS isolation or process-environment protection.

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

1. Keep untrusted project execution disabled on the shared host until the process can neither inspect host process environments nor access host/project files outside its own scope.
2. Demonstrate a separately enforced OS boundary for the actual process, including filesystem, credentials, network egress, CPU, memory, process count, and lifetime limits.
3. Prove the runtime listener cannot escape the intended interface boundary, or document and verify the external gateway that enforces it.
4. Keep Candidate execution disabled until the above evidence covers the actual Candidate-to-Preview path rather than a test container or static-file server.

## 2. Filesystem and Local Agent security

### Findings

#### FS-01 — A selected source root does not limit the files sent to Builder

**Severity:** Medium data-minimization and cross-project-content risk.

**Confidence:** High from source.

Preview input collection walks `workspaceRoot` and places every eligible file into the archive. `sourceRoot` is validated and included in the manifest, then the Builder uses it as the build working root; it is not used to scope the collected archive. Thus selecting a nested app can still transfer other files from the project workspace to the Builder. Sensitive filenames, credential-pattern detection, exclusions, and byte/count limits reduce exposure but do not guarantee that unrelated source or proprietary content is excluded.

**Closure:** Decide whether workspace-level context is required for supported monorepos. Otherwise constrain the transfer to the declared source root plus an explicit, reviewed dependency set, and test that sibling project files never enter the archive.

#### FS-02 — ZIP extraction has a reachable high-severity dependency advisory and per-upload expansion

**Severity:** High availability risk pending dependency remediation and concurrency limits.

**Confidence:** High that the route parses authenticated user uploads with the affected package; exploitability of each advisory was not reproduced.

The upload route accepts ZIP files up to 50 MiB and uses `adm-zip` to parse them. Extraction checks metadata limits (10,000 entries, 64 MiB per entry, 256 MiB expanded total), rejects unsafe paths and links, and verifies decoded sizes. However, ZIP entry data is decompressed in-process with `entry.getData()`, so concurrent authenticated uploads can consume substantial memory. The repository dependency scan reports high advisories for the locked `adm-zip` version. This audit did not reproduce an exploit or modify dependencies.

**Closure:** Upgrade to a fixed compatible release after checking API compatibility, add an aggregate concurrent upload/decompression budget, and verify malformed, oversized, and highly compressed archives fail within bounded memory and time.

#### FS-03 — Upload directory permissions rely on the host umask

**Severity:** Medium, conditional on other processes sharing the same filesystem/OS identity.

**Confidence:** High that the application does not explicitly set a private mode at directory creation.

The authenticated upload handler creates `/tmp/eos-upload-<random UUID>` without specifying a restrictive mode. The upload record is owner-scoped and expires after one hour, but filesystem confidentiality currently relies on the host umask and the shared-host process model. This combines with RT-01: OS-level access is not isolated by project ownership.

**Closure:** Create upload roots with an explicit private mode, keep all cleanup owner-scoped and root-confined, and test permission behavior on the deployed filesystem.

#### FS-04 — Local Agent security is a design contract, not an implemented boundary

**Severity:** Readiness blocker for cloud-hosted Local Agent use; no present Local Agent endpoint was found.

**Confidence:** High for the reviewed repository state.

The PRS describes pairing, outbound TLS, scoped jobs, root confinement, revocation, and secret/Docker-socket exclusions, but no Local Agent implementation was found in the reviewed API or dashboard paths. These requirements must remain a future qualification gate, not be treated as controls already enforced by the application.

### Existing controls observed

- Project roots are canonicalized and checked against the workspace boundary before persistence.
- Candidate build input reads pin directory descriptors, reject symlinks and hardlinks, compare file identity/metadata around reads, check candidate digests before and after collection, enforce file/count/total-byte limits, and reject common sensitive paths and high-confidence credential patterns.
- Delivery-workspace reads and writes use pinned roots, no-follow opens, path containment checks, atomic file replacement, and content/tree identity checks.
- Uploaded ZIP extraction validates paths, rejects special/link entries, performs metadata limits before decompression, checks actual decoded sizes, and uses exclusive file creation.
- Upload IDs and lookup/removal operations are scoped to the authenticated owner, with a one-hour expiry and cleanup path.

### Closure criteria for area 2

1. Scope Builder inputs to the selected source root or document and test the minimum required monorepo context.
2. Remove the vulnerable archive-parser version and bound aggregate decompression concurrency, not only per-upload sizes.
3. Set and verify private filesystem modes for uploads, Local Agent workspaces, artifacts, and cleanup roots.
4. Do not enable Local Agent until pairing, root confinement, lease expiry, revocation, update trust, and cross-project denial are implemented and tested.

**Remediation evidence:** Candidate archive creation now reads and packages only the explicitly selected nested `sourceRoot`, preserving its relative path for the existing Builder profile. It still verifies the full Candidate tree hash before and after collection, while excluding sibling paths from the archive and Manifest. `sourceRoot: "."` intentionally selects the whole Candidate; supporting workspace-level dependencies outside a nested root remains a future explicit allowlist decision. Tests reject symlink/missing roots and prove sibling content is absent. This closes the sibling-file transfer portion of FS-01 for nested roots only; the dependency-parser/concurrency and actual Agent qualification findings remain open.

## 3. Secrets, environment, and database isolation

### Findings

#### SEC-01 — Same-UID Runtime can bypass the child environment allowlist

**Severity:** Critical for shared or multi-user deployments; see RT-01.

**Confidence:** High from process ownership and read-permission checks; no secret contents were accessed.

`Workspace Runtime` constructs a filtered child environment, but the process runs as the same OS user as the API and supervisor. The read-only host check confirmed that the API/supervisor process environment files are readable by that user. Therefore the allowlist does not isolate host secrets from an untrusted project script. This is the most urgent finding in this audit and should be resolved before enabling untrusted project execution on a shared instance.

#### SEC-02 — Preview tasks have a narrower credential boundary than Workspace Runtime

**Severity:** No direct Preview-task secret exposure found in the reviewed definitions; actual deployment remains unverified.

**Confidence:** High for the checked task definitions and runner validation code.

Builder and static Preview task definitions are checked for the absence of a task role, injected secrets, unexpected environment variables, and extra mounts. Builder receives only its fixed configuration and a short-lived job token plus input/output presigned URLs through a server-side-encrypted S3 environment file; the token and URLs are bounded to a short job lifetime, while the object lifecycle is one day. The static runtime receives only the bound artifact key, digest, and URL. Neither task definition receives the API database URL, user AI-provider keys, or application session secret. The Attestor is a separate task that receives its signing key from Secrets Manager and has a separately scoped role.

These are source-level safeguards in an optional Terraform/AWS path. The repository's AWS Preview README states that the foundation has not been applied and no images/tasks/public Gateway are deployed, so this is not evidence of a live-cloud configuration.

#### SEC-03 — Database tenant isolation is application-enforced, not database-enforced

**Severity:** Medium defense-in-depth gap; no direct Preview-task database access was found.

**Confidence:** High for the repository schema/migration search.

No PostgreSQL row-level security policies were found in the reviewed migrations/schema. Project ownership is enforced by API middleware and query predicates, while the application uses the shared server-side database connection. This is consistent with the current application boundary, but it means a process that obtains the API database credential is not constrained by project-level database policy. Builder and static Preview tasks do not receive database credentials in the reviewed task definitions.

#### SEC-04 — Encrypted provider credentials lack a ciphertext key version

**Severity:** Low operational resilience concern; no plaintext storage was found in the reviewed credential path.

**Confidence:** High from source.

User API keys are stored in AES-256-GCM form with a fresh IV and authentication tag, using `AI_CREDENTIALS_ENCRYPTION_KEY`. The stored format has no key identifier/version, so rotating the environment key requires a coordinated decrypt-and-re-encrypt migration; otherwise existing ciphertext becomes unreadable. This is a rotation/recovery concern, not evidence that the key or plaintext was exposed.

### Existing controls observed

- Preview job tokens are Ed25519-signed, domain-separated, bound to project/proposal/operation/revision/Candidate/hash/image/artifact identities, and expire within five minutes.
- Builder job environment envelopes are written with conditional creation and server-side encryption; Terraform expires the envelope prefix after one day.
- Builder task validation rejects a task role, unapproved environment or secret injection, and unexpected mounts/ports; the Builder image is digest-pinned and non-root with a read-only root filesystem.
- The Preview runtime receives only artifact-reference values and is validated to have no task role, secrets, extra environment, or mounted volumes.
- The Attestor signing key is delivered separately through Secrets Manager; the Attestor verifies the Builder task and output before signing a receipt.
- The AWS foundation is explicitly opt-in and is documented as not deployed.

### Closure criteria for area 3

1. Close RT-01 with process/credential isolation before treating the host Runtime as safe for untrusted projects.
2. Preserve the separation between API database credentials and all Builder/Preview task environments; verify it against a deployed task definition before launch.
3. Decide whether database-level tenant enforcement is required for the deployment's threat model; if so, add and test a scoped role/RLS policy rather than relying only on route middleware.
4. Add a versioned key-rotation/migration contract for encrypted user credentials before rotating the encryption key.
5. Verify cloud IAM, S3 lifecycle, Secrets Manager, and log redaction against live configuration before claiming the optional AWS path is secure.

## 4. Candidate-to-Release provenance

### Findings

#### PROV-01 — Build and attestation identities are strongly bound, but the live journey is not wired

**Severity:** High readiness gap; no receipt-forgery defect found in the reviewed path.

**Confidence:** High from source; production behavior is unverified because the AWS foundation is not deployed.

The Build Job and signed Attestor receipt bind project, proposal, operation, proposal revision, Candidate revision, change-set hash, source/archive/output digests, build/image identity, and artifact key. The API checks ownership and revalidates the current Candidate in a transaction before creating a build job. Session creation requires an in-process verified receipt, a verified build job, and a matching current Candidate; it stores the receipt/output/image identities, limits TTL to 30 minutes, and prevents duplicate sessions for the same receipt. Access-ticket ledger checks also bind the current owner, session, Candidate, and expiry and atomically prevent a ticket from being reused.

However, the reviewed route tree exposes build start/status and Attestor acceptance, but no production route or caller was found for `createStartingPreviewSession`/`createPreviewSessionOrchestrator`. The browser-verification helper is not evidence that a real ECS Preview session was opened through the Workspace. Therefore the strong module-level contracts do not yet prove the end-to-end Candidate → build → attestation → session → browser path.

#### PROV-02 — Preview evidence is not acceptance, Canonical Proof, application, or release evidence

**Severity:** High product-readiness gap for Candidate Review and release.

**Confidence:** High; this separation is explicit in the code contracts and PRS.

The build receipt proves that an independently configured Attestor checked a specific output artifact against a specific Build Job. It does not approve the change, establish Canonical Proof, authorize application, or prove a release. The reviewed Workspace plan defers the integrated Candidate Review/Outcome flow to UXW-04 and release/deployment provenance to UXW-08. No end-to-end record was found that carries the same `proposalId`, `operationId`, `candidateRevision`, and `changeSetHash` through review, acceptance, apply, and delivery.

### Positive evidence observed

- Build Job creation locks and rechecks the current owner-bound Candidate before persisting a job.
- Signed build-job claims and Attestor receipts use Ed25519, domain-separated canonical payloads, short expiries, and exact identity/digest comparisons.
- Attestor checks the Builder task definition, task identity, successful exit, image digest, and bounded output digest before signing.
- API acceptance independently verifies the receipt against its durable Build Job before transitioning the job to `verified`.
- Preview Session creation rechecks the current Candidate and verified receipt under transaction, binds the selected artifact and runtime image/task definition, caps TTL, and rejects duplicate receipt sessions.
- Session readiness and access-ticket consumption require an unexpired, owner-matched, still-current Candidate and registered runner task.
- Browser verification rejects a mismatched requested revision and keeps its evidence separate from Canonical Proof.

### Closure criteria for area 4

1. Wire the verified Build → Session path into the authenticated Workspace and demonstrate it against a real deployed Preview runtime.
2. Recheck current Candidate identity at session creation, readiness, ticket issuance/consumption, and every state transition that could revive or expose a session.
3. Keep Browser Verification, acceptance, Canonical Proof, apply, and release as distinct claims; connect them through exact identity references without promoting one claim into another.
4. Complete UXW-04 and the later release path with one auditable identity chain through review, apply, and delivery.
5. Demonstrate that a stale Candidate, reused receipt, changed image, foreign project/session, and late worker all fail closed.

## 5. Network, Gateway, and public exposure

### Findings

#### NET-01 — The planned public Preview Gateway is not deployed or wired

**Severity:** High readiness gap; no unintended public Preview exposure found in the reviewed AWS foundation.

**Confidence:** High for the repository state; no live cloud account was queried.

The AWS README states that the foundation has not been applied and has no ECR images, ECS tasks/services, load balancer, or public listener. The Terraform source has no ALB, listener, DNS, or TLS certificate resources. The Gateway security group starts with no ingress and only adds private control/data-plane egress. A signed 30-second, one-time Preview ticket and a PostgreSQL use ledger exist, but no public Preview route was found that issues or redeems the ticket and proxies content to a session. The current gateway app exposes internal control/build/attestation endpoints, not a public session-content gateway.

This is fail-closed today, but it also means no visitor-facing Preview URL or real browser journey is currently proven.

#### NET-02 — Workspace Runtime project code has unrestricted host network access

**Severity:** Critical for untrusted project code on a shared host; see RT-01 and SEC-01.

**Confidence:** High from the process launch boundary.

Workspace Runtime starts the project development script without a network namespace, egress policy, or server-owned bind-host restriction. Project code can make outbound connections and can bind its assigned port beyond loopback. The port allocator and process-owner observation only prove that a listener exists and which process owns it; they do not restrict network reachability. This is not the isolated Preview runtime described in the PRS.

#### NET-03 — Public URL, Origin, and browser-access protections remain unqualified

**Severity:** High readiness blocker before public exposure.

**Confidence:** High from the absence of a public Gateway route/deployment.

The ticket module correctly binds a ticket to user, project, session, proposal, revision, Candidate hash, and change-set hash; it uses a 30-second lifetime, stores only a digest, and atomically consumes it only while the matching session and Candidate remain active. Those controls are not yet exercised through an actual public Gateway that validates Host/Origin, cookie/CSRF behavior, and the upstream destination for every request. No public TLS/DNS deployment was found.

### Existing controls observed

- Internal Gateway endpoints have bounded request bodies, reject unsupported encodings, return generic errors, disable proxy trust, and do not expose control routes as a public Preview content endpoint.
- Control commands are signed, short-lived, bound to session and Candidate identities, and sent over HTTPS with redirects rejected and a request timeout.
- AWS security groups are source-restricted between Gateway, static runner, and AWS endpoints; Preview tasks have no public IP and the runner accepts only the fixed app port from the Gateway.
- Builder and runtime artifact URLs are HTTPS S3 URLs with bounded signatures/expiry and redirects rejected; the static runtime checks artifact key, digest, size, and archive format.
- Git repository discovery restricts source URLs to credential-free HTTPS `github.com` addresses before optional server-side credential injection.
- The ticket ledger stores a ticket digest rather than the ticket itself and rechecks active owner/session/Candidate state on redemption.

### Closure criteria for area 5

1. Keep public exposure disabled until a Gateway route, TLS/DNS edge, ticket issue/redeem flow, and current-session revalidation are deployed and tested.
2. Enforce exact Host/Origin policy, no user-selected upstream host/port/IP, and no credential-bearing Preview URL; use a server-resolved destination only.
3. Test DNS/redirect/private/link-local/metadata rejection on every user-influenced fetch path, including candidate build transfers and public proxy requests.
4. Restrict Workspace Runtime egress and listener binding or keep it unavailable for untrusted projects; do not treat API port checks as a network boundary.
5. Verify the real security-group and routing behavior against deployed cloud state before making claims based on Terraform source.

## 6. Observability, resource limits, and cost

### Findings

#### OPS-01 — Workspace Runtime has no enforced compute, process-count, network, or hard-lifetime ceiling

**Severity:** Critical availability and isolation gap when running untrusted code on a shared host.

**Confidence:** High from the process launch path.

Workspace Runtime bounds startup time to 30 seconds, shutdown waits, the port range, and retained log lines. It does not enforce per-process CPU, memory, PID count, disk usage, network egress, or a maximum session lifetime at the OS boundary. The child is started detached under the API/supervisor UID. These are lifecycle controls, not resource isolation.

#### OPS-02 — Preview build admission is not globally cost-bounded

**Severity:** High cost and availability risk before enabling multiple users.

**Confidence:** High for the reviewed service paths.

Build creation prevents another active job for the same project/user/proposal and uses an idempotency key. The Gateway limits concurrent archive uploads to one per process, and reconciliation handles a bounded batch per pass. No Preview-specific per-user/per-project global concurrency budget, service-wide queue ceiling, or durable spend limit was found. The per-proposal check and per-process upload counter do not prevent work from being spread across proposals or Gateway replicas.

#### OPS-03 — AWS task resources and data retention are bounded in source, but unmeasured in a deployment

**Severity:** Medium residual operations risk; actual spend is currently absent because resources are not deployed.

**Confidence:** High for checked Terraform and runtime definitions.

The Builder task is fixed at 1 vCPU/2 GiB, non-root, read-only root filesystem, and has a 120-second build timeout. The static Preview task validator requires 256 CPU units/512 MiB and no task role or extra mounts; Preview Sessions are capped at 30 minutes. Attestor uses 256 CPU units/512 MiB. Input/output artifacts are size-limited and S3 lifecycle expires build artifacts and envelopes after one day. CloudWatch retention defaults to seven days and is configurable from one to fourteen days. The Builder `/tmp` volume has no explicit Fargate ephemeral-storage size configured in this Terraform.

No CloudWatch metric alarms, service autoscaling policy, or budget alert were found in the AWS Preview Terraform. Since no resources have been applied, these limits and costs have not been confirmed against live service behavior.

#### OPS-04 — Repository scans found high-severity dependency items and low-severity log findings

**Severity:** High dependency triage required; three logging findings are low severity.

**Confidence:** High for scanner output; individual reachability varies.

The dependency scanner reported 40 high, 45 moderate, and 11 low findings; SAST reported zero findings. The HoundDog scan reported three low findings: the Dashboard journey writes a test email value to stdout, and two AI modules log admission/task budget decisions. At least one high-severity dependency finding, `adm-zip`, is reachable on the authenticated archive-upload path and is already covered by FS-02; the audit did not reproduce any advisory or change dependencies. The remaining scanner findings still need ownership and reachability triage rather than blanket package changes.

### Existing controls observed

- Workspace Runtime retains at most 120 log lines, each truncated to 600 characters, and redacts common credential-shaped strings.
- Builder input and output are bounded; the Builder has a fixed timeout, digest-pinned image, restricted dependency set, and a task definition without injected secrets.
- Preview task CPU/memory, TTL, session identity, S3 object expiry, and log retention are fixed or bounded in source.
- Reconciliation processes a bounded batch rather than loading every job in one pass.
- AWS resource creation is disabled by default, preventing accidental resource spend from Terraform without explicit enablement.

### Closure criteria for area 6

1. Add OS-enforced CPU, memory, PID, disk, network, and maximum-lifetime limits to the actual Workspace/Candidate runtime.
2. Add durable global and per-owner/per-project admission limits for Builds and Sessions, including safe behavior across multiple API/Gateway replicas.
3. Add resource-exhaustion, queue-age, failed-cleanup, and cost alarms before enabling cloud resources.
4. Set an explicit Builder ephemeral-storage limit and test behavior at every CPU, memory, disk, upload, output, and runtime boundary.
5. Triage all dependency advisories by reachable path; prioritize the upload parser and run its tests after upgrading or replacing it.
6. Remove or redact the three low-severity log values where they are not needed, especially test identifiers that could contain user data.

## Verification limits

- This is a source/configuration audit, not a live AWS assessment. No AWS account state, ECR image, deployed task, public endpoint, DNS/TLS configuration, or production database was queried.
- No Candidate/project-supplied code was executed; no adversarial payloads were run.
- No schema, code, IAM, cloud resource, or GitHub branch was changed.
- Seven focused contract/unit test files passed (33 tests) for ticket handling, receipt verification, ECS task validation, Gateway control, and session state/orchestration. These tests do not establish a deployed end-to-end Preview journey.
- The API and Dashboard workflows were already failing in the workspace because their configured ports were occupied. No workflow restart or live browser journey was attempted during this read-only review.
- Scanner counts are repository-wide; they do not by themselves establish reachability or exploitability.

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
- `artifacts/api-server/src/lib/preview-build-input.ts`
- `artifacts/api-server/src/lib/archive-safety.ts`
- `artifacts/api-server/src/routes/upload.ts`
- `artifacts/api-server/src/lib/upload-store.ts`
- `artifacts/api-server/src/lib/project-materialization.ts`
- `artifacts/api-server/src/lib/delivery-workspace.ts`
- `docs/ux-workspace-prs.md` (Local Agent contract)
