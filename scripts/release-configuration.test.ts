import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runControlledReleaseValidation =
  process.env.RUN_CONTROLLED_RELEASE_VALIDATION === "1";

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

test(
  "allows deployment post-build to continue after a successful recovery gate",
  {
    skip: !runControlledReleaseValidation,
    timeout: 300_000,
  },
  () => {
    const result = spawnSync("pnpm", ["run", "validate:release:controlled"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      },
      encoding: "utf8",
      timeout: 280_000,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    assert.equal(
      result.status,
      0,
      `controlled release validation must complete after recovery succeeds:\n${output}`,
    );
    assert.match(
      output,
      /Real process-recovery validation completed successfully\./,
      "the real recovery check must report success before post-build completes",
    );
  },
);

test("reports a controlled recovery failure by name", async () => {
  const result = spawnSync(
    "pnpm",
    ["run", "validate:release"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        DATABASE_URL: "",
        OPENROUTER_API_KEY: "",
      },
      encoding: "utf8",
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0, "the controlled recovery check must fail");
  assert.match(
    output,
    /> workspace@[^ ]+ validate:release/,
    "deployment output must identify the release validation command",
  );
  assert.match(
    output,
    /Real process-recovery validation requires provider\/database configuration/,
    "deployment output must name the blocked process-recovery validation",
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

  const nextWorkflowStart = replitConfig.indexOf(
    "[[workflows.workflow]]",
    projectWorkflowStart + "[[workflows.workflow]]".length,
  );
  const projectWorkflow = replitConfig.slice(projectWorkflowStart, nextWorkflowStart);
  assert.doesNotMatch(
    projectWorkflow,
    /validate:release|release-process-recovery|dashboard-restart-smoke/,
  );

  const releaseWorkflowCommands = commandsBetween(
    replitConfig,
    'name = "release-process-recovery"',
    "[workflows.workflow.metadata]",
  );
  assert.deepEqual(releaseWorkflowCommands, [
    'args = "RELEASE_VALIDATION_WAIT_FOR_LOCK=1 pnpm run validate:release"',
  ]);

  const normalTestCommand = packageJson.scripts?.test;
  const releaseTestCommand = packageJson.scripts?.["validate:release"];
  const controlledReleaseTestCommand =
    packageJson.scripts?.["validate:release:controlled"];
  assert.equal(normalTestCommand, "pnpm -r --if-present run test");
  assert.equal(
    releaseTestCommand,
    "pnpm --filter @workspace/api-server run typecheck && pnpm run test:dashboard-journey-contract && pnpm run test:mission-correlation-report && pnpm --filter @workspace/api-server run test:release-fixture-collisions && pnpm --filter @workspace/api-server run test:release-synthesis-telemetry && pnpm --filter @workspace/api-server run test:process-recovery",
  );
  assert.equal(
    controlledReleaseTestCommand,
    "RUN_CONTROLLED_RELEASE_VALIDATION=1 pnpm run validate:release",
  );
  assert.notEqual(normalTestCommand, releaseTestCommand);
});

test("keeps the standalone journey responsible for service orchestration", async () => {
  const replitConfig = await readWorkspaceFile(".replit");
  const journeyStart = replitConfig.indexOf('name = "release-dashboard-journey"');
  assert.ok(journeyStart >= 0);
  const journeySection = replitConfig.slice(journeyStart);
  assert.match(
    journeySection,
    /args = "RELEASE_VALIDATION_WAIT_FOR_LOCK=1 DASHBOARD_E2E_EXECUTABLE_PATH=\$\(command -v chromium\) DASHBOARD_E2E_SKIP_API_CONTRACTS=1 pnpm run validate:dashboard-journey"/,
  );
  assert.doesNotMatch(
    replitConfig.slice(0, journeyStart),
    /name = "release-dashboard-journey"/,
  );
});
