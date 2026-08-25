import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowPath = join(root, ".github/workflows/ci.yml");
const policyPath = join(root, ".github/dashboard-contract-trigger-policy.json");
const dashboardSourceRoot = join(root, "artifacts/dashboard/src");

async function readPolicy() {
  return JSON.parse(await readFile(policyPath, "utf8"));
}

async function readWorkflowTriggerPatterns() {
  const workflow = await readFile(workflowPath, "utf8");
  const filterStart = workflow.indexOf("            contract:\n");
  assert.notEqual(filterStart, -1, "Workflow must define a contract path filter.");
  const filterEnd = workflow.indexOf("\n\n  contract-drift:", filterStart);
  assert.notEqual(filterEnd, -1, "Workflow contract path filter is malformed.");
  return [...workflow.slice(filterStart, filterEnd).matchAll(/^\s+- '([^']+)'$/gm)].map(
    (match) => match[1],
  );
}

async function readContractJobCondition() {
  const workflow = await readFile(workflowPath, "utf8");
  const jobStart = workflow.indexOf("  contract-drift:\n");
  assert.notEqual(jobStart, -1, "Workflow must define the contract-drift job.");
  const conditionStart = workflow.indexOf("    if:", jobStart);
  const stepsStart = workflow.indexOf("    steps:", conditionStart);
  assert.notEqual(conditionStart, -1, "Contract-drift job must define a condition.");
  assert.notEqual(stepsStart, -1, "Contract-drift job condition is malformed.");
  return workflow.slice(conditionStart, stepsStart);
}

async function readContractTriggerPaths() {
  const policy = await readPolicy();
  return [...policy.contractSources, ...Object.entries(policy.dashboardConsumers)
    .filter(([, decision]) => decision === "trigger")
    .map(([path]) => path)];
}

function pathMatchesPattern(pattern, changedPath) {
  return pattern.endsWith("/**")
    ? changedPath.startsWith(pattern.slice(0, -3))
    : changedPath === pattern;
}

function triggersContractCheck(triggerPatterns, changedPaths) {
  return triggerPatterns.some((pattern) =>
    changedPaths.some((changedPath) => pathMatchesPattern(pattern, changedPath)),
  );
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

test("contract fast path covers representative source changes", async () => {
  const triggerPatterns = await readWorkflowTriggerPatterns();

  for (const [changedPaths, expected] of [
    [["lib/api-spec/openapi.yaml"], true],
    [["lib/api-zod/src/generated/index.ts"], true],
    [["artifacts/dashboard/src/pages/Projects.tsx"], true],
    [["lib/api-client-react/src/use-ai-chat-stream.ts"], true],
    [["artifacts/dashboard/src/pages/Landing.tsx"], false],
    [["artifacts/dashboard/src/pages/Landing.tsx", "artifacts/dashboard/src/pages/Projects.tsx"], true],
  ]) {
    assert.equal(
      triggersContractCheck(triggerPatterns, changedPaths),
      expected,
      `Changed pull-request files ${JSON.stringify(changedPaths)} should ${
        expected ? "" : "not "
      }trigger the contract fast path`,
    );
  }
});

test("contract job evaluates the real changed-path filter output", async () => {
  const condition = await readContractJobCondition();

  assert.match(
    condition,
    /needs\.contract-trigger\.outputs\.should_run == 'true'/,
    "Contract-drift must be gated by the changed-path filter output.",
  );
  assert.doesNotMatch(
    condition,
    /github\.event\.pull_request\.changed_files/,
    "Contract-drift must not treat changed_files (a numeric count) as paths.",
  );
});

test("every production dashboard API consumer has an explicit trigger decision", async () => {
  const policy = await readPolicy();
  const triggerPaths = await readContractTriggerPaths();
  const sourceFiles = (await listSourceFiles(dashboardSourceRoot)).filter(
    (file) => !/\.(test|spec)\.[^.]+$/.test(file),
  );
  const apiConsumerPattern =
    /@workspace\/api-client-react|@\/lib\/api-fetch|from ["'][^"']*api-fetch["']|fetch\(\s*["']\/api\//;
  const consumers = [];

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (apiConsumerPattern.test(source)) {
      consumers.push(relative(root, file));
    }
  }

  assert.ok(
    consumers.length > 0,
    "Expected to discover dashboard API consumers",
  );
  assert.deepEqual(
    Object.values(policy.dashboardConsumers).filter(
      (decision) => decision !== "trigger" && decision !== "no-trigger",
    ),
    [],
    'Dashboard consumer decisions must be either "trigger" or "no-trigger".',
  );
  assert.deepEqual(
    consumers.filter((path) => !Object.hasOwn(policy.dashboardConsumers, path)),
    [],
    "New dashboard API consumers must be explicitly classified in " +
      ".github/dashboard-contract-trigger-policy.json.",
  );
  assert.deepEqual(
    Object.keys(policy.dashboardConsumers).filter(
      (path) => !consumers.includes(path),
    ),
    [],
    "The trigger policy must not contain removed or undetected dashboard consumers.",
  );
  assert.deepEqual(
    Object.keys(policy.dashboardConsumers).filter(
      (path) => policy.dashboardConsumers[path] === "trigger" && !triggerPaths.includes(path),
    ),
    [],
    "Trigger decisions in the policy must be represented in the workflow fast path.",
  );
});

test("workflow trigger representation stays synchronized with the policy", async () => {
  const expectedPaths = await readContractTriggerPaths();
  const actualPatterns = await readWorkflowTriggerPatterns();
  const actualPaths = actualPatterns.map((pattern) =>
    pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern,
  );

  assert.deepEqual(
    actualPaths,
    expectedPaths,
    "The workflow trigger expression is stale; regenerate it from " +
      ".github/dashboard-contract-trigger-policy.json.",
  );
});
