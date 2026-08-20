import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readWorkspaceFile(fileName: string): Promise<string> {
  return readFile(resolve(workspaceRoot, fileName), "utf8");
}

function commandsBetween(value: string, start: string, end: string): string[] {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);
  const section = value.slice(startIndex, endIndex);
  return section.match(/args\s*=\s*"([^"]+)"/g) ?? [];
}

test("keeps release recovery validation before deployment cleanup", async () => {
  const packageJson = JSON.parse(await readWorkspaceFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const deploymentCommand = packageJson.scripts?.["deployment:post-build"];

  if (typeof deploymentCommand !== "string") {
    assert.fail("deployment:post-build must be defined");
  }
  const deploymentSteps = deploymentCommand.split(" && ");
  const recoveryIndex = deploymentSteps.indexOf("pnpm run validate:release");
  const cleanupIndex = deploymentSteps.indexOf("pnpm store prune");

  assert.notEqual(recoveryIndex, -1);
  assert.notEqual(cleanupIndex, -1);
  assert.ok(
    recoveryIndex < cleanupIndex,
    "release recovery validation must run before pnpm store prune",
  );
});

test("surfaces recovery gate failures in the deployment post-build result", async () => {
  const packageJson = JSON.parse(await readWorkspaceFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const replitConfig = await readWorkspaceFile(".replit");
  const deploymentCommand = packageJson.scripts?.["deployment:post-build"];

  if (typeof deploymentCommand !== "string") {
    assert.fail("deployment:post-build must be defined");
  }

  const postBuildStart = replitConfig.indexOf("[deployment.postBuild]");
  const workflowsStart = replitConfig.indexOf("[workflows]", postBuildStart);
  assert.ok(postBuildStart >= 0);
  assert.ok(workflowsStart > postBuildStart);
  assert.match(
    replitConfig.slice(postBuildStart, workflowsStart),
    /args = \["pnpm", "run", "deployment:post-build"\]/,
    "deployments must report the post-build validation command as their result",
  );

  const deploymentSteps = deploymentCommand.split(" && ");
  const recoveryStep = deploymentSteps.find(
    (step) => step === "pnpm run validate:release",
  );
  assert.equal(recoveryStep, "pnpm run validate:release");
  assert.doesNotMatch(
    deploymentCommand,
    /\|\|/,
    "release gate failures must propagate instead of being masked",
  );
});

test("keeps the local Project workflow and release validation separate", async () => {
  const replitConfig = await readWorkspaceFile(".replit");
  const packageJson = JSON.parse(await readWorkspaceFile("package.json")) as {
    scripts?: Record<string, string>;
  };

  assert.match(replitConfig, /^runButton = "Project"$/m);

  const projectWorkflowStart = replitConfig.indexOf('name = "Project"');
  const releaseWorkflowStart = replitConfig.indexOf(
    'name = "release-process-recovery"',
  );
  assert.ok(projectWorkflowStart >= 0);
  assert.ok(releaseWorkflowStart > projectWorkflowStart);

  const projectWorkflow = replitConfig.slice(
    projectWorkflowStart,
    releaseWorkflowStart,
  );
  assert.doesNotMatch(
    projectWorkflow,
    /validate:release|release-process-recovery/,
  );

  const releaseWorkflowCommands = commandsBetween(
    replitConfig,
    'name = "release-process-recovery"',
    "[workflows.workflow.metadata]",
  );
  assert.deepEqual(releaseWorkflowCommands, [
    'args = "pnpm run validate:release"',
  ]);

  const normalTestCommand = packageJson.scripts?.test;
  const releaseTestCommand = packageJson.scripts?.["validate:release"];
  assert.equal(normalTestCommand, "pnpm -r --if-present run test");
  assert.equal(
    releaseTestCommand,
    "pnpm --filter @workspace/api-server run test:process-recovery",
  );
  assert.notEqual(normalTestCommand, releaseTestCommand);
});
