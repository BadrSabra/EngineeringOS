# Engineering Agent OS-Isolated Lifecycle Runner

## Decision

The lifecycle remains `BLOCKED_BEFORE_BROWSER` in the Replit workspace. Do not
start the API or Playwright here. The workspace does not expose verifiable
loopback-only OS network isolation: its network namespace cannot be compared
with PID 1, `eth0` and `sit0` are present, an IPv4 default route exists, and the
IPv6 route table is unavailable. A previous attempt to create a network
namespace with `unshare --net` was denied by the host.

The lifecycle runner now checks the namespace at the beginning of
`scripts/run-goal-first-e2e.mjs`, before it creates its temporary root, local
Git fixture, or PostgreSQL cluster. `scripts/run-dashboard-journey.mjs`
repeats the check before starting release services. Both checks fail closed.
The runtime egress hooks remain test-fixture-only and are defense in depth;
they are not evidence of OS isolation.

## Required execution environment

Use a dedicated Linux CI runner, VM, or host-managed network namespace that
provides all of the following before invoking any project command:

- A distinct network namespace for the test job and its descendants.
- `lo` as the only network interface; no IPv4 or IPv6 default route, tunnel,
  bridge, or externally reachable interface.
- Readable namespace identity and complete IPv4 and IPv6 route evidence.
- No network egress from the runner. Do not rely on application code, proxy
  settings, DNS configuration, or a fake provider as the OS boundary.
- Node.js, pnpm, workspace dependencies, PostgreSQL tools, Git, tar, and the
  selected Playwright browser preinstalled. Do not install packages during the
  test.
- A disposable local PostgreSQL cluster, an isolated local Git fixture, and
  the local provider and authentication fixtures.
- A unique temporary directory and free loopback-only ports. Never stop or
  reuse the Replit service on port `23183`.

The namespace must be established by the runner or host administrator, not by
weakening the project gate or expanding safe roots. If the host cannot provide
these properties, stop with `BLOCKED_BEFORE_BROWSER`.

## Ordered gates in the isolated runner

### Gate 1: verify the runner before starting test services

From the repository root, record the namespace snapshot and require the
project's live verifier to pass:

```sh
node --input-type=module -e '
  import {
    inspectLoopbackOnlyNetworkSnapshot,
    readLoopbackOnlyNetworkSnapshot,
  } from "./scripts/loopback-only-network-namespace.mjs";
  const snapshot = readLoopbackOnlyNetworkSnapshot();
  const result = inspectLoopbackOnlyNetworkSnapshot(snapshot);
  console.log(JSON.stringify({ snapshot, result }, null, 2));
  if (!result.ok) process.exit(2);
'
```

Do not start PostgreSQL, API, dashboard, or browser before this passes. Also
verify that a short-lived child process reports the same network namespace as
the runner. Record the runner and child namespace identities with the CI job
evidence. The full process tree must remain within the same OS boundary.

### Gate 2: run focused guard tests inside that runner

```sh
node --test \
  scripts/isolated-child-process-policy.test.mjs \
  scripts/runtime-egress-guard.test.mjs \
  scripts/owned-runtime-cleanup.test.mjs \
  scripts/loopback-only-network-namespace.test.mjs
```

These tests verify software policy and fixture behavior. Passing them alone
does not establish real OS isolation or prove that API child-process call
sites work.

### Gate 3: keep lifecycle-only compatibility work out of the API smoke

Static review found lifecycle call sites that are not yet demonstrated
compatible with the child-process policy. They are not required by the
API-only health/readiness smoke, which does not invoke Mission actions, Git
delivery, project bootstrap, or quality-gate commands:

- `local-bare-github-adapter.ts` invokes `git read-tree` and `git rev-list`;
  neither is currently in `SAFE_GIT_SUBCOMMANDS`. Add only exact, root-scoped
  local operations after testing their argument forms in isolation.
- The API package's `dev` script runs a build, the old-API cleanup script, and
  `start`. The runtime guard is injected with `NODE_OPTIONS`; if that reaches
  the pnpm wrapper, the child-process policy can block pnpm's own nested
  commands. The isolated launcher must preload the guard into the API Node
  process, not indiscriminately into the package-manager supervisor.
- `ai-release-quality-gate.ts` currently uses `sh -c` for check commands.
  The test policy intentionally rejects arbitrary shell commands. Use fixed
  executable/argument profiles or leave those checks blocked; do not widen
  shell permission to make the journey pass.
- `project-bootstrap.ts` uses `pnpm install`. The child policy forces offline
  package settings and does not allow install. The runner must use an
  already-materialized, disposable project fixture; no network package
  installation is allowed.
- Do not broaden permissions for these commands to make the API smoke pass.
  If API startup itself attempts a child process or external connection, the
  guard audit makes the smoke fail and the owned API process is stopped.
- Exercise the actual local Git, runtime, archive, quality-check, and cleanup
  call sites inside the OS namespace before separately authorizing the full
  lifecycle journey.

These gaps still block the full browser journey. They do not turn the
API-only smoke into a Mission test.

### Gate 4: API-only smoke test; no browser

The independent API-only harness is `scripts/run-api-only-smoke.mjs`; its
coordinator tests use injected fakes and never start PostgreSQL or the API.
The real command is intentionally not run in the Replit workspace. It requires
a dedicated disposable checkout with verified OS-level loopback-only network
isolation. The explicit disposable-checkout flag is a safety acknowledgement,
not proof of network isolation:

```sh
ENGINEERINGOS_API_ONLY_SMOKE_DISPOSABLE_CHECKOUT=1 \
  pnpm run validate:api-only-smoke
```

The harness:

1. Checks process/child network namespaces, interfaces, routes, and
   network-administration capabilities before creating test services.
2. Builds directly with `node artifacts/api-server/build.mjs`. This build
   removes only `artifacts/api-server/dist`; preflight therefore requires that
   directory to be absent, so run it only in the disposable checkout.
3. Creates PostgreSQL under a unique system-temp root, binds it only to
   `127.0.0.1`, and runs the official `pnpm --filter @workspace/db run
   schema:apply` with only that database's URL.
4. Confirms the connected database identity and zero rows in lifecycle,
   execution, task, proposal, acceptance, delivery, receipt, and episode
   entities before API startup and after the read-only smoke.
5. Starts `dist/index.mjs` directly with a minimal test-fixture environment
   and the runtime egress guard; it does not run `pnpm dev`, the old-API
   cleanup script, Clerk, OpenRouter, GitHub, or any browser.
6. Calls only `GET /api/healthz` and `GET /api/readiness` on loopback; checks
   health, API/database/schema readiness, the API and PostgreSQL namespace,
   and the egress/child-process audit.
7. Stops only its owned API process group and temporary PostgreSQL cluster.
   It verifies process/port shutdown and persists the report before deleting
   the owned database root. Unverified cleanup retains the root and reports
   `cleanup_incomplete`.

The mock-based coordinator suite can be run without services:

```sh
pnpm run test:api-only-smoke
```

Those tests verify ordering, ownership, failure handling, and evidence
retention. They are not an API startup or API readiness result. The API-only
smoke has not run; the CLI was attempted only through its fail-closed preflight.
Lifecycle status remains
`BLOCKED_BEFORE_BROWSER`.

### Manual GitHub Actions runner

`.github/workflows/api-only-smoke-isolated.yml` is a separate, opt-in
`workflow_dispatch` workflow. It requires the operator to set the confirmation
input to `true` and separately approve
`allow_dependency_bootstrap_egress`; both inputs default to `false`. It has only
`contents: read`, and checks Docker's `--network none` before checkout or
project commands. If Docker isolation is unavailable, the workflow fails before
checkout, dependency installation, build, or PostgreSQL creation.

The container uses a version-pinned Node base image, PostgreSQL 16.10 tools,
pnpm 10.26.1, a non-root UID, read-only root filesystem, dropped capabilities,
`no-new-privileges`, resource limits, and no Docker socket or forwarded host
secrets. Image preparation is **not globally offline**: after the explicit
approval, the hosted runner pulls the Node base image, and Docker image build
steps fetch OS packages/signing material and pnpm dependencies. This approval
is not a destination allowlist and does not enable network access for the API
smoke process. The workflow records the approval before pulling the image, so
the policy remains available when isolation preflight fails. GitHub Actions
checkout, runner-control, and artifact-upload traffic also use GitHub services.
The final smoke container uses `--network none`; inside it, a
network/namespace/capability preflight writes evidence first, then
`pnpm install --offline --frozen-lockfile` runs before the existing API-only
command. The workflow records the explicit bootstrap approval and the runtime
container's `none` network setting alongside the source SHA. There is no host
fallback and no Playwright step. Reports are mounted to a unique runner-temp
directory outside the disposable checkout and uploaded even when the smoke
fails. The container and its unique image tag are removed by the owning
workflow step.

This boundary isolates the application smoke from Clerk, OpenRouter, GitHub
APIs, and other network destinations. It does **not** claim that the GitHub
Actions job or dependency-image build has no external network traffic. If the
policy requires zero external fetches during image preparation too, do not
dispatch this workflow until those inputs are preloaded in a trusted immutable
image or a controlled offline runner.

Docker has a separate PID namespace, so `/proc/1/ns/net` inside the container
identifies its init process rather than the host. The workflow reads the host
namespace ID before starting Docker and passes only that comparison value to
the strict network checker; loopback-only interfaces/routes and child namespace
inheritance are still checked from inside the container.

This workflow has only been reviewed and structurally tested. It has not been
dispatched; no image was built and no API or PostgreSQL process was started.
The first real run remains a separate, manually approved action.

### Gate 5: separately authorize one browser journey

Only after the API-only gate, database readiness, local provider/auth fixtures,
child-process compatibility, and evidence-path checks pass may an operator
start the one-shot lifecycle command:

```sh
pnpm run validate:engineering-agent-lifecycle-e2e
```

The command must run entirely inside the same verified OS namespace. Use a
unique run ID/results root, preserve prior receipts and logs, and retain the
Mission/Goal/Execution/Proposal/Acceptance/Delivery/Receipt correlation report.
Do not auto-run this final gate from the API-only harness.

## Scope and evidence

This runbook does not change product behavior, authentication, provider
routing, or the proof/approval gates. It does not authorize Development or
Production database access, deployment, external Clerk/OpenRouter/GitHub
traffic, or cleanup of unrelated processes. The current Replit attempt
created no Mission, Goal, Execution, Proposal, Acceptance, Delivery, Receipt,
temporary database, or API-smoke run directory. No API or browser journey was
started from this workspace.

The API-only smoke, container-preflight, workflow, and namespace tests pass
30/30, but those results are software-level checks only. A Replit preflight
attempt is retained at
`test-results/api-only-smoke/b8dba56d-07ee-4322-a09a-d217feb4c79e/`; it failed
before build or database creation because OS network isolation was not
verifiable. No Mission, Goal, Execution, Proposal, Acceptance, Delivery, or
Receipt was created. The API-only smoke and browser journey remain unrun.
