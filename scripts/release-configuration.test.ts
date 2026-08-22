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
  return section.match(/args\s*=\s*"((?:\\"|[^"])*)"/g) ?? [];
}

type ReleaseFailureScenario = {
  name: string;
  command: string;
  diagnostic: string;
  laterCommands: string[];
};

type DeploymentFailureScenario = {
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

const deploymentFailureScenarios: DeploymentFailureScenario[] = [
  {
    name: "audit schema check",
    command: "run db:schema:check",
    diagnostic: "audit schema check failed: expected audit_events table was missing",
    laterCommands: [
      "run test:benchmark-rollout",
      "run verify:benchmark-rollout",
      "run validate:release",
      "store prune",
    ],
  },
  {
    name: "benchmark rollout tests",
    command: "run test:benchmark-rollout",
    diagnostic: "benchmark rollout tests failed: rollout fixture was incomplete",
    laterCommands: [
      "run verify:benchmark-rollout",
      "run validate:release",
      "store prune",
    ],
  },
  {
    name: "benchmark rollout verifier",
    command: "run verify:benchmark-rollout",
    diagnostic: "benchmark rollout verifier failed: provider-unavailable cases block deployment",
    laterCommands: ["run validate:release", "store prune"],
  },
  {
    name: "release validation",
    command: "run validate:release",
    diagnostic: "release validation failed: process recovery did not complete",
    laterCommands: ["store prune"],
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
        APP_ORIGINS: "https://dashboard.example.com",
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

async function runDeploymentWithInjectedFailure(
  scenario: DeploymentFailureScenario,
): Promise<{ output: string; trace: string; status: number | null }> {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "deployment-step-failure-"),
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
  exit 29
fi
if [ "$*" = "run deployment:post-build" ]; then
  exec "${realPnpm}" "$@"
fi
exit 0
`,
    "utf8",
  );
  await chmod(shimPath, 0o755);

  try {
    const result = spawnSync("pnpm", ["run", "deployment:post-build"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        APP_ORIGINS: "https://dashboard.example.com",
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

async function runSuccessfulDeploymentFixture(): Promise<{
  output: string;
  trace: string;
  status: number | null;
  temporaryDirectory: string;
}> {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "deployment-success-"),
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
if [ "$*" = "run deployment:post-build" ]; then
  exec "${realPnpm}" "$@"
fi
exit 0
`,
    "utf8",
  );
  await chmod(shimPath, 0o755);

  const result = spawnSync("pnpm", ["run", "deployment:post-build"], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      APP_ORIGINS: "https://dashboard.example.com",
      PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
      RELEASE_VALIDATION_TRACE: tracePath,
    },
    encoding: "utf8",
  });

  return {
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    trace: await readFile(tracePath, "utf8"),
    status: result.status,
    temporaryDirectory,
  };
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

test("runs deployment checks in order and prunes only after successful release validation", async () => {
  const before = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).stdout;
  const fixture = await runSuccessfulDeploymentFixture();

  try {
    assert.equal(
      fixture.status,
      0,
      `successful deployment fixture must remain zero:\n${fixture.output}`,
    );
    assert.deepEqual(fixture.trace.trim().split("\n"), [
      "run deployment:post-build",
      "run db:schema:check",
      "run test:benchmark-rollout",
      "run verify:benchmark-rollout",
      "run validate:release",
      "store prune",
    ]);
    assert.ok(
      fixture.trace.indexOf("run validate:release") <
        fixture.trace.indexOf("store prune"),
      "pnpm store prune must start only after release validation succeeds",
    );
  } finally {
    await rm(fixture.temporaryDirectory, { recursive: true, force: true });
  }

  const after = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).stdout;
  assert.equal(
    after,
    before,
    "temporary deployment fixtures must leave no working-tree changes",
  );
});

test("reports a missing production origin before controlled recovery", async () => {
  const result = spawnSync(
    "pnpm",
    ["run", "validate:release"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        DATABASE_URL: "",
        OPENROUTER_API_KEY: "",
        APP_ORIGINS: "",
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
    /APP_ORIGINS must contain at least one approved dashboard origin in production/,
    "deployment output must name the missing production origin configuration",
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
          APP_ORIGINS: "https://dashboard.example.com",
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

for (const scenario of deploymentFailureScenarios) {
  test(`stops deployment post-build after a ${scenario.name} diagnostic`, async () => {
    const { output, trace, status } =
      await runDeploymentWithInjectedFailure(scenario);

    assert.notEqual(
      status,
      0,
      `${scenario.name} failure must keep deployment post-build non-zero`,
    );
    assert.match(
      output,
      new RegExp(scenario.diagnostic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${scenario.name} diagnostic must remain visible in deployment output`,
    );
    assert.match(
      trace,
      new RegExp(scenario.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${scenario.name} must start before deployment post-build stops`,
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
    'args = "APP_ORIGINS=\\"https://${REPLIT_DEV_DOMAIN}\\" RELEASE_VALIDATION_WAIT_FOR_LOCK=1 pnpm run validate:release"',
  ]);

  const normalTestCommand = packageJson.scripts?.test;
  const releaseTestCommand = packageJson.scripts?.["validate:release"];
  const controlledReleaseTestCommand =
    packageJson.scripts?.["validate:release:controlled"];
  assert.equal(normalTestCommand, "pnpm -r --if-present run test");
  assert.equal(
    releaseTestCommand,
    "pnpm run validate:app-origins && pnpm --filter @workspace/api-server run typecheck && pnpm run test:dashboard-journey-contract && pnpm run test:release-port-cleanup && pnpm run test:mission-correlation-report && pnpm --filter @workspace/api-server run test:release-fixture-collisions && pnpm --filter @workspace/api-server run test:release-synthesis-telemetry && pnpm --filter @workspace/api-server run test:process-recovery",
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
    /args = "APP_ORIGINS=\\"https:\/\/\$\{REPLIT_DEV_DOMAIN\}\\" RELEASE_VALIDATION_WAIT_FOR_LOCK=1 DASHBOARD_E2E_EXECUTABLE_PATH=\$\(command -v chromium\) DASHBOARD_E2E_SKIP_API_CONTRACTS=1 pnpm run validate:dashboard-journey"/,
  );
  assert.doesNotMatch(
    replitConfig.slice(0, journeyStart),
    /name = "release-dashboard-journey"/,
  );
});

test("keeps release teardown evidence attached to the controlled journey", async () => {
  const workflow = await readWorkspaceFile(".github/workflows/ci.yml");
  const releaseJobStart = workflow.indexOf("  release-validation:");
  assert.ok(releaseJobStart >= 0, "release-validation job must remain configured");

  const nextJobOffset = workflow
    .slice(releaseJobStart + 1)
    .search(/\n  \S/);
  const nextJobStart =
    nextJobOffset >= 0 ? releaseJobStart + 1 + nextJobOffset : -1;
  const releaseJob = workflow.slice(
    releaseJobStart,
    nextJobStart >= 0 ? nextJobStart : workflow.length,
  );

  assert.match(
    releaseJob,
    /pnpm run validate:dashboard-journey/,
    "release validation must run the controlled dashboard journey",
  );
  assert.match(
    releaseJob,
    /DASHBOARD_E2E_TEARDOWN_ARTIFACT_PATH:\s*test-results\/dashboard-journey\/release-teardown\.json/,
    "release validation must configure the teardown report path",
  );
  assert.match(
    releaseJob,
    /name:\s*release-validation-\$\{\{\s*github\.run_id\s*\}\}-teardown/,
    "release teardown evidence must use a run-specific artifact name",
  );
  assert.match(
    releaseJob,
    /if:\s*always\(\)/,
    "release teardown evidence must upload even after validation fails",
  );
  assert.match(
    releaseJob,
    /path:\s*test-results\/dashboard-journey\/release-teardown\.json/,
    "release teardown upload must use the configured report path",
  );
});
