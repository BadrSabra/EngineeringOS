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

async function readWorkflowTriggerPaths() {
  const workflow = await readFile(workflowPath, "utf8");
  return [
    ...workflow.matchAll(
      /contains\(github\.event\.pull_request\.changed_files,\s*'([^']+)'\)/g,
    ),
  ].map((match) => match[1]);
}

async function readContractTriggerPaths() {
  const policy = await readPolicy();
  return [...policy.contractSources, ...Object.entries(policy.dashboardConsumers)
    .filter(([, decision]) => decision === "trigger")
    .map(([path]) => path)];
}

function triggersContractCheck(triggerPaths, changedPath) {
  return triggerPaths.includes(changedPath);
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
  const triggerPaths = await readWorkflowTriggerPaths();

  for (const [changedPath, expected] of [
    ["artifacts/dashboard/src/pages/Projects.tsx", true],
    ["lib/api-client-react/src/use-ai-chat-stream.ts", true],
    ["artifacts/dashboard/src/pages/Landing.tsx", false],
  ]) {
    assert.equal(
      triggersContractCheck(triggerPaths, changedPath),
      expected,
      `${changedPath} should ${expected ? "" : "not "}trigger the contract fast path`,
    );
  }
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
  const actualPaths = await readWorkflowTriggerPaths();

  assert.deepEqual(
    actualPaths,
    expectedPaths,
    "The workflow trigger expression is stale; regenerate it from " +
      ".github/dashboard-contract-trigger-policy.json.",
  );
});
