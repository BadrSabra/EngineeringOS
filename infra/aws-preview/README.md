# AWS Preview foundation

This is a **local-only Terraform foundation** for the first supported preview:
a Vite/React frontend packaged as an immutable static-site image. It is not a
running Preview service.

## Safety boundary

- `enable_foundation_resources` defaults to `false`.
- No AWS resources have been created or applied. No images have been published
  to ECR; there are no deployed ECS tasks/services, load balancer, or public
  listener. Terraform has optional, digest-pinned Builder and Attestor Task
  Definitions; they register only when their release inputs are supplied and
  the foundation is explicitly enabled. The signing-secret resource contains
  no secret value.
- No Terraform plan or apply has been run. Do not apply this template without
  separate approval for AWS region, VPC/subnet CIDRs and Availability Zones,
  spending limits, and Candidate data transfer.
- The template does not reuse the project's live Runtime, validator, or
  browser-test container as a Preview runtime.

## Intended first runtime

The first supported target is a Vite/React frontend. The local Builder source
implements binding an explicit server-selected source root and static `dist`
output to the exact `candidateRevision`/`changeSetHash`, plus a bounded
one-time S3 artifact upload. No AWS Builder task invokes it yet.
Preview sessions use one fixed static-file runtime image and Task Definition,
both pinned by server-owned configuration; Candidate code never chooses an OCI
image or registers ECS tasks. The Fargate task must serve only the uploaded
static files on port 8080 as a non-root user with a read-only root filesystem
and no AWS task role. This foundation does not deploy a Builder/runtime image
or transfer Candidate files to AWS.

Arbitrary `npm run dev`, project lifecycle scripts, dependency installation,
and unsupported project types are out of scope. A missing or unsupported
artifact must fail closed rather than falling back to the live project.
The output archive contract is gzip-compressed POSIX ustar with `index.html` at
the root; links, extended/special tar records, traversal paths, oversized
archives, and oversized files are rejected.

The Builder ignores Candidate Vite/PostCSS configuration and package scripts,
links only the pinned dependency allowlist, and never installs Candidate
dependencies. Its input verifier rejects traversal, links, mismatched file
digests, and a source root without `index.html`. Before any S3 access, it also
requires an API-signed, short-lived Ed25519 build job. The signed claims bind the
Candidate, source root/digest, input archive, output key, Builder profile, and
trusted Builder image digest; caller-provided environment values cannot replace
those identities. This token alone does not provide replay prevention or prove
which ECS image ran. In deployment, the verification key must come from a
fixed Builder Task Definition that Gateway validates and cannot be overridden
by the command; Gateway now validates the fixed Builder task contract before
launch. Gateway fencing and independent output attestation remain required.

`infra/aws-preview/builder/` contains the Builder, fixed Vite configuration,
and container recipe. The Docker build helper stages only workspace package
manifests and Builder source; it does not copy Candidate files, local
credentials, generated worktrees, or the full repository into the image
context. It requires a digest-pinned Node base image, pins Corepack to the
workspace's `pnpm@10.26.1`, and builds local images only. A local smoke build
used the official `node:24-bookworm-slim` amd64 manifest
`sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e`;
this is a build input, not an ECR application-image digest. The Builder image
has not been published; the Preview runtime image has not been built.

`infra/aws-preview/attestor/` contains a separate one-off Fargate Attestor. It
verifies the API-signed job, inspects the exact stopped Builder task and pinned
task definition, hashes the actual bounded S3 output bytes, and writes an
API-compatible short-lived signed receipt to a private S3 prefix. The Docker
build helper stages only required package manifests and trusted Attestor
sources. A local Attestor image was built and smoke-tested, but not published.
Its optional ECS Task Definition has not been registered because no image
digest is configured and no AWS resource has been applied.

The runtime image source is in `infra/aws-preview/runtime/`. Build it only in a
trusted release environment with `NODE_BASE_IMAGE` pinned to a reviewed
container digest; do not build or publish it from Candidate-controlled files.
The image has not been built or pushed to ECR.

## Network foundation

When explicitly enabled and fully configured, the template creates a VPC with
two public subnets reserved for a future TLS Gateway and two private subnets
for preview tasks. Private subnets have no Internet default route and no NAT
gateway. Runner ingress is limited to the Gateway security group on the fixed
preview port. Runner egress is limited to private ECR/CloudWatch endpoints and
the regional S3 endpoint, whose policy allows ECR layer reads and scopes
Preview artifact access to the dedicated private bucket's build, command
envelope, and receipt prefixes. The artifact bucket blocks public access,
enforces server-side encryption, and expires these objects after one day. The
output retention exceeds the receipt and maximum session lifetimes; any future
cleanup job must still check active session references.

The Gateway orchestration location is now selected as a task inside AWS. An
ECS interface endpoint is included so the future Gateway can orchestrate tasks
and the Attestor can inspect Builder task identity without a NAT route. A
Secrets Manager endpoint supplies the signing key to the Attestor execution
role only. These endpoints incur cost once the foundation is enabled.

The Gateway security group has no public ingress yet. A public HTTPS load
balancer, DNS/TLS certificate, Gateway service identity, and the ECS task
deployment still require configuration before any user can open a Preview.
The API remains the owner of PostgreSQL and sends short-lived
Ed25519-signed start/stop commands to the Gateway; the API keeps the private
key and the Gateway receives only the public verification key. The browser
must never choose the upstream address or port.

The local orchestration core and HTTP Gateway entrypoint are tested but not
deployed. The separate `start:preview-gateway` process accepts bounded signed
control, build-input upload, Builder-launch, and Attestor-launch routes plus
`/healthz`; it uses the ECS task role and rejects static AWS credentials or
PostgreSQL connection variables.

The Builder-launch route accepts only the API-signed, short-lived job. After
verification, it derives the input and output object identities from signed
claims, checks the object-scoped S3 URLs generated by its fixed transfer
provider, and inspects one fixed Builder Task Definition.
It requires the registered image digest, execution role, non-root user,
read-only filesystem, dropped Linux capabilities, no task role, no injected
secrets or extra environment/ports, and the exact public verification key
preconfigured in that Task Definition. It allows only the task-scoped
`builder-tmp` volume mounted writable at `/tmp`; other volumes and mount paths
are rejected. Fargate destroys this scratch storage with the task
([Fargate task storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)).
The public key is never supplied as a
task override. It then atomically claims the signed `jobId` in a separate
DynamoDB fence and launches one Fargate task in private subnets with no public
IP. A retry is accepted only after a strongly consistent DynamoDB read confirms
the same signed-job and launch-configuration fingerprint. The Gateway reuses
the immutable environment-file ARN and the same ECS client token and launch
parameters, allowing an ambiguous response to resolve to the original task
rather than creating another build. A changed fingerprint, expired job, or
mismatched environment-file metadata remains rejected. This is bounded
same-operation recovery, not a general retry or reconciliation loop.

The static preview runtime still launches with its session-scoped idempotency
token, private subnets, no public IP, and a fixed runner security group. Before
launch it checks the runtime Task Definition for the exact ECR image digest,
fixed execution role, no task role, one non-root container, read-only
filesystem, no injected environment/secrets/volumes, dropped Linux
capabilities, and fixed port 8080.

The Gateway IAM role can describe/run only the preview, Builder, and Attestor
task families in the selected cluster, stop only tasks in that cluster, and
pass only the preview execution role, Builder execution role, and Attestor
roles. It can create and confirm task environment envelopes only in their
separate S3 prefixes and read receipts from the receipt prefix. The Builder
execution role can read only its own prefix so the ECS agent can load its
environment file; the Builder has no task role and cannot access AWS
credentials from that execution role. The Attestor execution role can read
only its command envelope and the signing secret; its separate task role can
describe ECS resources, read only Builder outputs, and write receipts. It
cannot read the signing key, start/stop tasks, write build outputs, or access
PostgreSQL. DynamoDB
holds only execution fences: the command table tracks session command
versions; the Builder table records a job ID, launch fingerprint, claimed
status, and TTL; the Attestor table separately fences its own task identity
and fingerprint. Neither is a source of Candidate or session truth. All are
reachable only through the private DynamoDB gateway endpoint, and remain
disabled with the rest of the Terraform foundation.

The Gateway process requires `AWS_REGION` (or `AWS_DEFAULT_REGION`),
`PREVIEW_CONTROL_PUBLIC_KEY_PEM`, `PREVIEW_COMMAND_FENCE_TABLE`,
`PREVIEW_BUILD_INPUT_BUCKET`,
`PREVIEW_ECS_CLUSTER_ARN`, `PREVIEW_TASK_DEFINITION_ARN_PREFIX`,
`PREVIEW_ECR_REPOSITORY_URI`, `PREVIEW_RUNNER_EXECUTION_ROLE_ARN`,
`PREVIEW_PRIVATE_SUBNET_IDS`, and `PREVIEW_RUNNER_SECURITY_GROUP_ID`.
Builder launch additionally requires `PREVIEW_BUILD_JOB_FENCE_TABLE`,
`PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM`, `PREVIEW_BUILDER_TASK_DEFINITION_ARN`,
`PREVIEW_BUILDER_ECR_REPOSITORY_URI`, `PREVIEW_BUILDER_IMAGE_DIGEST`,
`PREVIEW_BUILDER_EXECUTION_ROLE_ARN`, `PREVIEW_BUILDER_PRIVATE_SUBNET_IDS`,
and `PREVIEW_BUILDER_SECURITY_GROUP_ID`. The Task Definition must contain the
same public key, bucket, and region as static environment and no preconfigured
environment files, and explicit Linux x86_64 runtime settings. It must also
declare only the task-scoped `builder-tmp` volume, mounted writable at `/tmp`;
host paths, EFS, extra volumes, and other mount paths are rejected. Gateway
writes the signed token and five-minute transfer
URLs to a unique, conditional, SSE-S3 environment file, then passes only its
S3 ARN in the ECS `environmentFiles` override. The token and URLs therefore
do not appear as ECS `RunTask` environment values. The envelope is restricted
to its job ID, accessible only through the Builder execution role, and expires
through the one-day S3 lifecycle rule; its token and URLs expire sooner.
The Builder has no ECS task role and uses the signed object URLs; only its
execution role reads the S3 environment envelope. Do not set
`DATABASE_URL`, `PG*` credentials, or static AWS access-key variables.

Attestor dispatch additionally requires `PREVIEW_BUILD_ATTESTOR_FENCE_TABLE`,
`PREVIEW_ATTESTOR_TASK_DEFINITION_ARN`, `PREVIEW_ATTESTOR_ECR_REPOSITORY_URI`,
`PREVIEW_ATTESTOR_IMAGE_DIGEST`, `PREVIEW_ATTESTOR_EXECUTION_ROLE_ARN`,
`PREVIEW_ATTESTOR_TASK_ROLE_ARN`,
`PREVIEW_ATTESTOR_RECEIPT_SIGNING_SECRET_ARN`,
`PREVIEW_ATTESTOR_PRIVATE_SUBNET_IDS`, and
`PREVIEW_ATTESTOR_SECURITY_GROUP_ID`. Gateway validates the registered
Attestor Task Definition against the exact image digest, static configuration,
role ARNs, non-root/read-only container, and the single expected signing-key
secret before it can run a task. Until all settings and the pinned Task
Definition are provisioned, omitting every Attestor setting leaves existing
Builder and Preview routes available; partially configured Attestor settings
fail Gateway startup rather than silently enabling an incomplete route.

When `preview_builder_task_definition_arn` is empty, Terraform registers the
fixed Builder Task Definition after `preview_builder_image_digest` and
`preview_build_job_public_key_pem` are supplied. An explicit ARN selects an
externally registered Builder definition instead. Terraform registers the
Attestor Task Definition when the Builder definition is available and
`preview_attestor_image_digest` is supplied. Terraform does not build or push
either image. The signing secret value remains outside Terraform state and
must be provisioned separately.

The API reconciliation worker includes durable `builder_succeeded` jobs. It
re-signs the stored job claims with a fresh five-minute token and sends them to
`POST /internal/v1/preview/builds/attest`. Gateway validates the exact stopped
Builder task, then launches or recovers one Attestor task using a separate
DynamoDB fence, a stable ECS client token, and a separate `startedBy` value.
The registered Attestor Task Definition contains static `AWS_REGION`, `PREVIEW_S3_BUCKET`,
`PREVIEW_ECS_CLUSTER_ARN`, `PREVIEW_BUILDER_TASK_DEFINITION_ARN`,
`PREVIEW_BUILDER_ECR_REPOSITORY_URI`, `PREVIEW_BUILDER_IMAGE_DIGEST`,
`PREVIEW_BUILDER_EXECUTION_ROLE_ARN`, and
`PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM` values. ECS injects
`PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM` from the Secrets Manager secret; the
Gateway must put only `PREVIEW_ATTESTOR_JOB_TOKEN` and
`PREVIEW_ATTESTOR_BUILDER_TASK_ARN` in a unique private S3 environment file
and pass its ARN to the task. Gateway returns only the signed receipt token
over the internal request; it does not validate or accept the proof. The API
independently verifies the receipt against the current durable job, Candidate
identity, output object, and receipt public key before transitioning the job
to `verified`. Pending tasks are polled by the existing worker, and jobs fail
closed if attestation fails, the receipt is rejected, or the 30-minute
attestation deadline is exceeded. Attestor accepts only its ECS task-role
credentials and has no database connection.

The API-side build-start route requires `PREVIEW_GATEWAY_URL`,
`PREVIEW_BUILD_INPUT_UPLOAD_PRIVATE_KEY_PEM`,
`PREVIEW_BUILD_JOB_PRIVATE_KEY_PEM`, `PREVIEW_BUILDER_IMAGE_DIGEST`, and
`PREVIEW_BUILD_SOURCE_ROOT`. The private keys stay in API Secrets. The upload
key pairs only with `PREVIEW_CONTROL_PUBLIC_KEY_PEM`; the build-job key pairs
with `PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM` in Gateway and Builder configuration.
The route fails closed when any setting is missing and returns only the durable
job identity/state, never the signed token or S3 artifact keys. The API-side
Preview-session route separately requires `PREVIEW_RUNTIME_IMAGE_DIGEST` and
the exact `PREVIEW_TASK_DEFINITION_ARN`; these select one fixed static-file
runtime and must not be derived from a Candidate build receipt.

## Intentionally omitted

- Candidate files are not copied to AWS; the ECR repository is empty.
- A bounded signed Gateway upload endpoint and a private one-day S3 bucket are
  implemented in code/templates, and an API upload client is tested, but no
  product route invokes it and neither AWS component is deployed. No Candidate
  data is transferred. The Gateway is not publicly reachable yet; API-to-AWS
  TLS ingress and upload orchestration remain unconfigured.
- PostgreSQL remains the canonical Preview database. Its schema defines an
  active-session registry and one-time ticket ledger. DynamoDB holds only the
  auxiliary execution fence.
  Sessions bind an isolated Candidate revision, immutable image digest, pinned
  Task Definition, ECS task ARN, and version-fenced lifecycle; ticket rows
  store only the digest and exact project/user/session/Candidate binding.
  These tables are applied to the development database only; they are not
  applied to production.
- The signed-command, artifact-upload, signed Builder-launch, API start/status,
  and bounded ECS reconciliation routes exist in code, but no AWS Gateway
  task, Builder Task Definition, or public HTTPS listener is deployed. The API
  reconciler recovers exact task identity and only records Builder success after
  a successful ECS exit plus a bounded direct read/hash of the encrypted S3
  output. The Gateway now launches or recovers a separate Attestor task and
  transports its receipt to the API; only the API may mark a job `verified`.
  These paths are covered locally but are not deployed: local Builder and
  Attestor images are not published, their Task Definitions are not registered,
  the signing secret has no value, and the API receipt verification key is not
  provisioned. Therefore no live AWS receipt is currently produced or accepted.
  The Builder implementation is still local source only. The Gateway never
  receives PostgreSQL credentials.
- The signed Start command now carries the exact build-output object key and
  SHA-256 digest from the accepted build receipt into the ECS container
  override. Before launch, Gateway checks the S3 object's size and stored
  SHA-256 checksum, then adds a five-minute, object-scoped HTTPS download URL
  to the fixed runtime's container override. A fixed static-runtime image
  source is now implemented: it verifies the downloaded archive digest,
  rejects links, traversal, unsupported tar entries and oversized files, then
  serves only in-memory static files. It does not execute Candidate code.
  The image has not been built or deployed, and the Builder has not been
  deployed or connected to the Gateway, so no Preview can start yet.
- Gateway now has a transfer-URL provider that verifies an encrypted input
  archive's stored size and SHA-256 checksum, then issues a five-minute GET for
  that input and a one-time conditional PUT for the unique output key. The
  private S3 endpoint and role policies scope build-input, build-output,
  Builder/Attestor command-envelope, and receipt prefixes separately.
- The Gateway Builder route accepts only a signed job token, verifies its
  signature and image digest, derives the exact input/output keys, generates
  and checks the object-scoped S3 transfer URLs, and validates a fixed Builder
  Task Definition whose environment contains the pinned public key. A DynamoDB
  condition fences each signed job ID. A strongly consistent read permits
  recovery only for the same unexpired fingerprint; Gateway confirms the
  existing envelope metadata and repeats an identical ECS `RunTask` request
  with the same client token, so an ambiguous response can resolve to its
  original task. Changed fingerprints and mismatched envelopes remain rejected.
  Gateway stores the token and URLs in a unique SSE-S3 environment file and
  passes only its S3 ARN to ECS; the Builder execution role can read only that
  prefix, and the bucket lifecycle expires envelopes after one day. Launch is
  fixed to one Fargate task, private networking, and no public IP. Local tests
  cover signature rejection before ECS access, Task Definition drift, transfer
  scope, envfile injection/encryption/conditional creation, same-request
  recovery, and changed-fingerprint rejection. API state changes to `verified`
  require a fresh receipt signed by the independently configured Attestor key,
  exact output-digest agreement, a live owner/Candidate revision lock, and a
  version-fenced transition. The reconciler and callback are code-only; no
  Gateway, Builder, or separate receipt producer is deployed.
- The Builder's local contract tests cover source-root and file-digest binding,
  hostile ZIP paths and symlinks, ignored lifecycle scripts, the fixed Vite
  configuration, required API-signed build jobs before artifact access,
  conditional output upload, and compatibility with the static runtime parser.
  A real local Vite build passed in the controlled fixture. API and Builder
  tests share a cross-runtime signed-job compatibility assertion.
  This does not prove ECS isolation, AWS transfer, attestation, or a user-facing
  Preview journey.
- Candidate source uploads expire after one day. Candidate output artifacts
  also expire after one day; any future explicit cleanup must retain bundles
  referenced by active sessions.
- There are no configured signing keys, Gateway image, Gateway ECS service,
  Attestor key, or long-lived AWS credentials. The API Attestor callback
  returns unavailable until its public key is configured.

VPC interface endpoints have hourly and data-processing costs when deployed.
This template is not cost-free once enabled.

## Local validation only

These commands format and validate Terraform without creating AWS resources:

```sh
tofu fmt -check -recursive
tofu init -backend=false
tofu validate
node --test scripts/aws-preview-foundation-contract.test.mjs
node --test infra/aws-preview/runtime/server.test.mjs
```

`tofu init` downloads the pinned provider into the ignored local
`.terraform/` directory. Keep state, plan files, local variables, and AWS
credentials out of Git.
