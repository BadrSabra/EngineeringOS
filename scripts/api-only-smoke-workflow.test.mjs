import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowPath = path.join(root, ".github/workflows/api-only-smoke-isolated.yml");
const dockerfilePath = path.join(root, ".github/api-only-smoke.Dockerfile");
const dockerIgnorePath = `${dockerfilePath}.dockerignore`;
const containerScriptPath = path.join(root, "scripts/run-api-only-smoke-container.sh");

async function readProjectFile(filePath) {
  return readFile(filePath, "utf8");
}

test("isolated API smoke workflow is manual-only, read-only, and opt-in", async () => {
  const source = await readProjectFile(workflowPath);
  const workflow = yaml.load(source);

  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(
    workflow.jobs["api-only-smoke"].if,
    "${{ inputs.confirm_isolated_smoke && inputs.allow_dependency_bootstrap_egress && github.ref == 'refs/heads/main' }}",
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.confirm_isolated_smoke.default,
    false,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.allow_dependency_bootstrap_egress.default,
    false,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.allow_dependency_bootstrap_egress.required,
    true,
  );
  assert.equal(workflow.jobs["api-only-smoke"].permissions.contents, "read");
  assert.equal(workflow.jobs["api-only-smoke"]["runs-on"], "ubuntu-24.04");
});

test("Docker isolation proof occurs before checkout or any project command", async () => {
  const workflow = yaml.load(await readProjectFile(workflowPath));
  const steps = workflow.jobs["api-only-smoke"].steps;
  const approvalIndex = steps.findIndex((step) =>
    step.name === "Record dependency-bootstrap network approval"
  );
  const preflightIndex = steps.findIndex((step) => step.id === "os-isolation");
  const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
  const buildRunIndex = steps.findIndex((step) =>
    step.name === "Build dependency image and run the isolated API-only smoke"
  );
  const preflightSource = steps[preflightIndex].run;

  assert.ok(approvalIndex >= 0);
  assert.ok(preflightIndex > approvalIndex);
  assert.ok(preflightIndex >= 0);
  assert.ok(checkoutIndex > preflightIndex);
  assert.ok(buildRunIndex > checkoutIndex);
  assert.match(preflightSource, /docker info/u);
  assert.match(preflightSource, /docker pull node:20\.20\.0-bookworm/u);
  assert.match(preflightSource, /--network none/u);
  assert.match(
    preflightSource,
    /const routesAreLoopback = \[\.\.\.ipv4Routes, \.\.\.ipv6Routes\]\s+\.every\(\(route\) => route\.iface === "lo"\);/u,
  );
  assert.match(preflightSource, /capabilitiesDropped/u);
  assert.match(preflightSource, /noNewPrivileges/u);
  assert.doesNotMatch(preflightSource, /pnpm|npm install|schema:apply|validate:api-only-smoke/iu);
});

test("checkout credentials are not persisted and no secrets or egress fallback are configured", async () => {
  const workflowSource = await readProjectFile(workflowPath);
  const workflow = yaml.load(workflowSource);
  const steps = workflow.jobs["api-only-smoke"].steps;
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  const runStep = steps.find((step) =>
    step.name === "Build dependency image and run the isolated API-only smoke"
  );
  const combined = `${workflowSource}\n${runStep.run}`;

  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with.path, "source");
  assert.match(checkout.uses, /@11bd71901bbe5b1630ceea73d27597364c9af683$/u);
  assert.match(combined, /--network none/u);
  assert.doesNotMatch(combined, /--network\s+host|--pid(?:=|\s+)host|docker\.sock|-p\s*\d/u);
  assert.doesNotMatch(workflowSource, /secrets\.|CLERK_SECRET_KEY|OPENROUTER_API_KEY/u);
  assert.doesNotMatch(workflowSource, /playwright/iu);
  assert.doesNotMatch(workflowSource, /(^|\s)(push|pull_request|schedule):/mu);
});

test("manual run records and verifies the exact source commit from the main-branch event", async () => {
  const workflow = yaml.load(await readProjectFile(workflowPath));
  const runStep = workflow.jobs["api-only-smoke"].steps.find((step) =>
    step.name === "Build dependency image and run the isolated API-only smoke"
  );

  assert.match(runStep.run, /expected_source_sha="\$\{GITHUB_SHA\}"/u);
  assert.match(runStep.run, /git -C "\$source_root" rev-parse --verify HEAD/u);
  assert.match(runStep.run, /"\$checked_out_source_sha" != "\$expected_source_sha"/u);
  assert.match(runStep.run, /source-revision\.json/u);
  assert.match(runStep.run, /dependencyBootstrapEgressApproved":true/u);
  assert.match(runStep.run, /apiSmokeContainerNetwork":"none"/u);
  assert.match(runStep.run, /ALLOW_DEPENDENCY_BOOTSTRAP_EGRESS.*!=.*true/u);
});

test("image-preparation egress requires separate operator approval and is distinct from runtime isolation", async () => {
  const workflow = yaml.load(await readProjectFile(workflowPath));
  const input = workflow.on.workflow_dispatch.inputs.allow_dependency_bootstrap_egress;
  const dockerfile = await readProjectFile(dockerfilePath);
  const policyStep = workflow.jobs["api-only-smoke"].steps.find((step) =>
    step.name === "Record dependency-bootstrap network approval"
  );
  const runStep = workflow.jobs["api-only-smoke"].steps.find((step) =>
    step.name === "Build dependency image and run the isolated API-only smoke"
  );

  assert.match(input.description, /Docker Hub/u);
  assert.match(input.description, /Debian\/PGDG/u);
  assert.match(input.description, /npm/u);
  assert.match(input.description, /--network none/u);
  assert.equal(
    policyStep.env.DEPENDENCY_BOOTSTRAP_EGRESS_APPROVED,
    "${{ inputs.allow_dependency_bootstrap_egress }}",
  );
  assert.match(policyStep.run, /bootstrap-network-policy\.json/u);
  assert.match(policyStep.run, /DEPENDENCY_BOOTSTRAP_EGRESS_APPROVED.*!=.*true/u);
  assert.match(policyStep.run, /dependencyBootstrapEgressApproved":%s/u);
  assert.match(policyStep.run, /apiSmokeContainerNetwork":"none"/u);
  assert.match(dockerfile, /apt-get update/u);
  assert.match(dockerfile, /curl --fail/u);
  assert.match(dockerfile, /npm install --global/u);
  assert.match(dockerfile, /pnpm fetch --frozen-lockfile --ignore-scripts/u);
  assert.match(runStep.run, /--network none/u);
  assert.match(
    runStep.env.ALLOW_DEPENDENCY_BOOTSTRAP_EGRESS,
    /\$\{\{ inputs\.allow_dependency_bootstrap_egress \}\}/u,
  );
});

test("runtime container is non-root, offline, bounded, and returns reports outside checkout", async () => {
  const workflow = yaml.load(await readProjectFile(workflowPath));
  const runStep = workflow.jobs["api-only-smoke"].steps.find((step) =>
    step.name === "Build dependency image and run the isolated API-only smoke"
  );
  const uploadStep = workflow.jobs["api-only-smoke"].steps.find((step) =>
    step.name === "Upload isolated smoke evidence"
  );

  assert.match(runStep.run, /--read-only/u);
  assert.match(runStep.run, /--cap-drop ALL/u);
  assert.match(runStep.run, /--security-opt no-new-privileges:true/u);
  assert.match(runStep.run, /--pids-limit 512/u);
  assert.match(runStep.run, /--memory 6g/u);
  assert.match(runStep.run, /--cpus 2/u);
  assert.match(runStep.run, /--user "\$\{smoke_uid\}:\$\{smoke_gid\}"/u);
  assert.match(runStep.run, /source_root="\$\{GITHUB_WORKSPACE\}\/source"/u);
  assert.match(runStep.run, /source=\$\{results_dir\},target=\/workspace\/test-results\/api-only-smoke/u);
  assert.match(runStep.run, /cleanup_owned_container/u);
  assert.match(runStep.run, /docker container rm --force/u);
  assert.match(runStep.run, /docker image rm "\$image_tag"/u);
  assert.match(runStep.run, /"\$owner" == "\$run_key"/u);
  assert.equal(uploadStep.if, "always()");
  assert.match(uploadStep.with.path, /\$\{\{ runner\.temp \}\}/u);
  assert.match(uploadStep.uses, /@ea165f8d65b6e75b540449e92b4886f43607fa02$/u);
});

test("dependency preparation is pinned and cannot run lifecycle scripts before isolation", async () => {
  const dockerfile = await readProjectFile(dockerfilePath);
  const dockerIgnore = await readProjectFile(dockerIgnorePath);
  const containerScript = await readProjectFile(containerScriptPath);
  const preflightIndex = containerScript.indexOf("api-only-smoke-container-preflight.mjs");
  const installIndex = containerScript.indexOf("pnpm install --offline --frozen-lockfile");
  const smokeIndex = containerScript.indexOf("pnpm run validate:api-only-smoke");

  assert.match(dockerfile, /^FROM node:20\.20\.0-bookworm$/mu);
  assert.match(dockerfile, /ARG PNPM_VERSION=10\.26\.1/u);
  assert.match(dockerfile, /ARG POSTGRES_PACKAGE_VERSION=16\.10-1\.pgdg120\+1/u);
  assert.match(dockerfile, /create_main_cluster = false/u);
  assert.match(dockerfile, /exit 101/u);
  assert.match(dockerfile, /pnpm fetch --frozen-lockfile --ignore-scripts/u);
  assert.match(dockerfile, /test "\$\(pg_ctl --version \| awk '\{ print \$3 \}'\)" = 16\.10/u);
  assert.doesNotMatch(dockerfile, /pnpm install|pnpm run/u);
  assert.match(dockerIgnore, /^\*$/mu);
  assert.doesNotMatch(dockerIgnore, /attached_assets|node_modules|\.git/u);
  assert.ok(preflightIndex >= 0);
  assert.ok(installIndex > preflightIndex);
  assert.ok(smokeIndex > installIndex);
  assert.match(containerScript, /pnpm install --offline --frozen-lockfile/u);
  assert.match(
    containerScript,
    /ENGINEERINGOS_API_ONLY_SMOKE_DISPOSABLE_CHECKOUT=1 pnpm run validate:api-only-smoke/u,
  );
});

test("container preflight writes evidence before stopping on isolation failure", async () => {
  const source = await readProjectFile(
    path.join(root, "scripts/api-only-smoke-container-preflight.mjs"),
  );

  assert.ok(
    source.indexOf("await persistEvidence(evidence)")
      < source.indexOf('if (!evaluation.ok)'),
  );
  assert.match(source, /inspectLoopbackOnlyNetworkSnapshot\(snapshot\)/u);
  assert.match(source, /readLoopbackOnlyNetworkSnapshot\(/u);
});
