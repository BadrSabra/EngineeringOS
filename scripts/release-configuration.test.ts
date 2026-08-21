import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
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

type ReleaseFailureScenario = {
  name: string;
  command: string;
  diagnostic: string;
  laterCommands: string[];
};

const releaseFailureScenarios: ReleaseFailureScenario[] = [
  {
    name: "dashboard journey contract",
    command: "run test:dashboard-journey-contract",
    diagnostic: "dashboard journey contract fixture failed: expected route was missing",
    laterCommands: [
      "run test:mission-correlation-report",
      "--filter @workspace/api-server run test:release-fixture-collisions",
      "--filter @workspace/api-server run test:release-synthesis-telemetry",
      "--filter @workspace/api-server run test:process-recovery",
    ],
  },
  {
    name: "mission correlation report",
    command: "run test:mission-correlation-report",
    diagnostic: "mission correlation report fixture failed: operation revision mismatched",
    laterCommands: [
      "--filter @workspace/api-server run test:release-fixture-collisions",
      "--filter @workspace/api-server run test:release-synthesis-telemetry",
      "--filter @workspace/api-server run test:process-recovery",
    ],
  },
  {
    name: "release fixture collision check",
    command: "--filter @workspace/api-server run test:release-fixture-collisions",
    diagnostic: "release fixture collision check failed: duplicate fixture identity",
    laterCommands: [
      "--filter @workspace/api-server run test:release-synthesis-telemetry",
      "--filter @workspace/api-server run test:process-recovery",
    ],
  },
  {
    name: "release synthesis telemetry",
    command: "--filter @workspace/api-server run test:release-synthesis-telemetry",
    diagnostic: "release synthesis telemetry failed: expected audit event was absent",
    laterCommands: [
      "--filter @workspace/api-server run test:process-recovery",
    ],
  },
  {
    name: "process recovery",
    command: "--filter @workspace/api-server run test:process-recovery",
    diagnostic: "process recovery failed: child server did not become ready",
    laterCommands: [],
  },
];

async function runReleaseWithInjectedFailure(
  scenario: ReleaseFailureScenario,
): Promise<{ output: string; trace: string; status: number | null }> {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "release-step-failure-"),
  );
  const tracePath = resolve(temporaryDirectory, "pnpm-trace.log");
  const shimPath = resolve(temporaryDirectory, "pnpm");
  const realPnpm = spawnSync("sh", ["-c", "command -v pnpm"], {
    encoding: "utf8",
  }).stdout.trim();

  await writeFile(
    shimPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$RELEASE_VALIDATION_TRACE"
if [ "$*" = "${scenario.command}" ]; then
  echo "${scenario.diagnostic}" >&2
  exit 23
fi
if [ "$*" != "run validate:release" ]; then
  exit 0
fi
exec "${realPnpm}" "$@"
`,
    "utf8",
  );
  await chmod(shimPath, 0o755);

  try {
    const result = spawnSync("pnpm", ["run", "validate:release"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
        RELEASE_VALIDATION_TRACE: tracePath,
      },
      encoding: "utf8",
    });
    return {
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      trace: await readFile(tracePath, "utf8"),
      status: result.status,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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

test("stops release validation after an API typecheck diagnostic", async () => {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "release-typecheck-failure-"),
  );
  const tracePath = resolve(temporaryDirectory, "pnpm-trace.log");
  const shimPath = resolve(temporaryDirectory, "pnpm");
  const realPnpm = spawnSync("sh", ["-c", "command -v pnpm"], {
    encoding: "utf8",
  }).stdout.trim();

  await writeFile(
    shimPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$RELEASE_VALIDATION_TRACE"
if [ "$1" = "--filter" ] && [ "$2" = "@workspace/api-server" ] && [ "$3" = "run" ] && [ "$4" = "typecheck" ]; then
  echo "src/routes/project.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'." >&2
  exit 1
fi
exec "${realPnpm}" "$@"
`,
    "utf8",
  );
  await chmod(shimPath, 0o755);

  try {
    const result = spawnSync(
      "pnpm",
      ["run", "validate:release"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
          RELEASE_VALIDATION_TRACE: tracePath,
        },
        encoding: "utf8",
      },
    );
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const trace = await readFile(tracePath, "utf8");

    assert.notEqual(
      result.status,
      0,
      `release validation must fail when the API typecheck fails:\n${output}`,
    );
    assert.match(
      output,
      /src\/routes\/project\.ts\(42,7\): error TS2322: Type 'string' is not assignable to type 'number'\./,
      "the API compiler diagnostic must remain visible in release output",
    );
    assert.match(
      trace,
      /--filter @workspace\/api-server run typecheck/,
      "the API typecheck must be the first release step",
    );
    assert.doesNotMatch(
      trace,
      /run test:dashboard-journey-contract|run test:mission-correlation-report|run test:process-recovery/,
      "later fixture and browser checks must not start after the API typecheck fails",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

for (const scenario of releaseFailureScenarios) {
  test(`stops release validation after a ${scenario.name} diagnostic`, async () => {
    const { output, trace, status } = await runReleaseWithInjectedFailure(scenario);

    assert.notEqual(
      status,
      0,
      `${scenario.name} failure must keep release validation non-zero`,
    );
    assert.match(
      output,
      new RegExp(scenario.diagnostic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${scenario.name} diagnostic must remain visible in release output`,
    );
    assert.match(
      trace,
      new RegExp(scenario.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${scenario.name} must start before release validation stops`,
    );
    for (const laterCommand of scenario.laterCommands) {
      assert.doesNotMatch(
        trace,
        new RegExp(laterCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${laterCommand} must not start after ${scenario.name} fails`,
      );
    }
  });
}

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
