import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { computeEngineeringAgentSourceFingerprint } from "./engineering-agent-source-fingerprint.mjs";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUser = "goal_first_e2e";
const databaseName = "postgres";
const dashboardPort = Number(process.env.DASHBOARD_E2E_DASHBOARD_PORT ?? 23184);
const lifecycleRun = process.env.ENGINEERING_AGENT_LIFECYCLE_E2E === "1";
const lifecycleRunId = lifecycleRun ? randomUUID() : null;
const lifecycleStartedAt = new Date().toISOString();
const lifecycleResultsRoot = resolve(
  workspaceRoot,
  "test-results/engineering-agent-lifecycle",
);
const lifecycleEvidenceRoot = resolve(
  workspaceRoot,
  "release-evidence/engineering-agent-lifecycle",
);
const lifecycleReceiptPath = lifecycleRun
  ? resolve(lifecycleEvidenceRoot, `${lifecycleRunId}.json`)
  : resolve(lifecycleResultsRoot, "receipt.json");
const lifecycleOfflineVerificationPath = lifecycleRun
  ? resolve(lifecycleEvidenceRoot, `${lifecycleRunId}.offline-verification.json`)
  : "";
const lifecycleEnvironmentIdentity = "replit-disposable-postgres-local-provider-fixture";
const lifecycleTestId =
  "engineering-agent-lifecycle: completes one correlated Chat-to-Mission apply and delivery chain";
const providerLogPath = resolve(
  workspaceRoot,
  lifecycleRun
    ? "test-results/engineering-agent-lifecycle/provider-fixture-requests.jsonl"
    : "test-results/goal-first-e2e/provider-fixture-requests.jsonl",
);

let temporaryRoot = "";
let dataDirectory = "";
let socketDirectory = "";
let lifecycleProjectRoot = "";
let lifecycleRemotePath = "";
let lifecycleRunnerStage = "setup";
let lifecycleSourceFingerprint = "";
let postgresPort = 0;
let initialized = false;
let activeChild;
let shutdownSignal;

function isolatedDatabaseEnvironment(databaseUrl = "") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG") || key === "DATABASE_URL") delete env[key];
  }
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  return env;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : options.stdio ?? "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        process.stderr.write(chunk);
      });
    }
    activeChild = child;
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (shutdownSignal) {
        rejectRun(new Error(`Interrupted by ${shutdownSignal}.`));
      } else if (code === 0) {
        resolveRun(options.capture ? { stdout, stderr } : undefined);
      } else {
        rejectRun(new Error(
          `${command} ${args.join(" ")} exited with ${signal ?? code}.`,
        ));
      }
    });
  });
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a loopback port for the isolated database.");
  }
  const port = address.port;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return port;
}

async function stopPostgres() {
  if (!initialized) return;
  try {
    await run("pg_ctl", [
      "-D", dataDirectory,
      "-m", "fast",
      "-w", "stop",
    ], {
      env: {
        ...isolatedDatabaseEnvironment(),
        PGHOST: "127.0.0.1",
        PGPORT: String(postgresPort),
        PGUSER: databaseUser,
      },
    });
  } catch {
    // Best-effort cleanup if initialization or startup was interrupted.
  }
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(contents);
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeFallbackLifecycleReceipt() {
  if (!lifecycleRun) return;
  const existingText = await readFile(lifecycleReceiptPath, "utf8").catch(() => "");
  let existing;
  try {
    existing = existingText ? JSON.parse(existingText) : undefined;
  } catch {
    existing = undefined;
  }
  if (existing?.status === "blocked") return;
  const failedStage = lifecycleRunnerStage.replaceAll("-", "_").toUpperCase();
  const receipt = {
    schemaVersion: 1,
    runId: lifecycleRunId,
    startedAt: lifecycleStartedAt,
    finishedAt: new Date().toISOString(),
    environmentIdentity: lifecycleEnvironmentIdentity,
    testId: lifecycleTestId,
    status: "blocked",
    stage: lifecycleRunnerStage,
    code: existing?.status === "passed"
      ? `${failedStage}_FAILED_AFTER_JOURNEY`
      : "RUNNER_FAILED_BEFORE_JOURNEY_RECEIPT",
    ...(lifecycleSourceFingerprint
      ? { sourceFingerprint: lifecycleSourceFingerprint }
      : {}),
  };
  await writeJsonAtomically(
    existing?.status === "passed"
      ? `${lifecycleReceiptPath}.runner-failure.json`
      : lifecycleReceiptPath,
    receipt,
  );
}

async function main() {
  const liveProviderRun = process.env.GOAL_FIRST_LIVE_PROVIDER === "1";
  if (lifecycleRun) {
    lifecycleSourceFingerprint = await computeEngineeringAgentSourceFingerprint({
      cwd: workspaceRoot,
    });
  }
  if (lifecycleRun && liveProviderRun) {
    throw new Error("The controlled lifecycle acceptance run cannot use the live provider.");
  }
  if (os.userInfo().uid === 0) {
    throw new Error("Refusing to initialize the temporary PostgreSQL cluster as root.");
  }

  temporaryRoot = await mkdtemp(join(os.tmpdir(), "engineeringos-goal-first-e2e-"));
  dataDirectory = join(temporaryRoot, "pgdata");
  socketDirectory = join(temporaryRoot, "socket");
  postgresPort = await reserveLoopbackPort();
  const databaseUrl = `postgresql://${databaseUser}@127.0.0.1:${postgresPort}/${databaseName}`;
  await mkdir(socketDirectory, { recursive: true });

  try {
    if (lifecycleRun) {
      lifecycleRemotePath = join(temporaryRoot, "engineering-agent-lifecycle-remote.git");
      lifecycleProjectRoot = resolve(
        workspaceRoot,
        "test-results",
        "engineering-agent-lifecycle",
        `project-${randomUUID()}`,
      );
      const remoteRelativePath = relative(
        await realpath(temporaryRoot),
        resolve(lifecycleRemotePath),
      );
      if (
        !remoteRelativePath
        || remoteRelativePath === ".."
        || remoteRelativePath.startsWith(`..${sep}`)
      ) {
        throw new Error("The disposable bare remote must remain inside the isolated runner root.");
      }
      await rm(lifecycleReceiptPath, { force: true });
      await rm(providerLogPath, { force: true });
      await mkdir(dirname(lifecycleProjectRoot), { recursive: true });
      await rm(lifecycleProjectRoot, { recursive: true, force: true });
      await run("git", ["init", "--bare", lifecycleRemotePath]);
      await run("git", [
        "--git-dir",
        lifecycleRemotePath,
        "symbolic-ref",
        "HEAD",
        "refs/heads/main",
      ]);
      if (await realpath(lifecycleRemotePath) !== resolve(lifecycleRemotePath)) {
        throw new Error("The disposable bare remote resolved outside its configured location.");
      }
    }

    await run("initdb", [
      "-D", dataDirectory,
      "-U", databaseUser,
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    initialized = true;

    await run("pg_ctl", [
      "-D", dataDirectory,
      "-o", `-h 127.0.0.1 -p ${postgresPort} -k ${socketDirectory} -c listen_addresses=127.0.0.1`,
      "-l", join(temporaryRoot, "postgres.log"),
      "-w", "start",
    ]);

    const env = isolatedDatabaseEnvironment(databaseUrl);
    env.RUN_CONTROLLED_RELEASE_VALIDATION = "1";
    env.DASHBOARD_E2E_TEST_MODE = liveProviderRun ? "live-provider" : "fixture";
    env.DASHBOARD_E2E_GREP = lifecycleRun
      ? "engineering-agent-lifecycle: completes one correlated Chat-to-Mission apply and delivery chain"
      : liveProviderRun
        ? "goal-first: cross-checks a read-only Mission across five files and reloads Canonical Proof"
        : "goal-first|signs in and traverses the authenticated operational shell|returns from Mission details to the original Chat session with its active Mission restored";
    env.DASHBOARD_E2E_BROWSER = process.env.DASHBOARD_E2E_BROWSER ?? "firefox";
    env.DASHBOARD_E2E_SKIP_API_CONTRACTS = "1";
    env.DASHBOARD_E2E_CHILD_TIMEOUT_MS = process.env.DASHBOARD_E2E_CHILD_TIMEOUT_MS
      ?? (lifecycleRun ? "600000" : "240000");
    if (liveProviderRun) {
      env.DASHBOARD_E2E_LIVE_PROVIDER = "1";
      env.DASHBOARD_E2E_LIVE_DISPOSABLE = "1";
      env.DASHBOARD_E2E_LIVE_CREATE_DISPOSABLE = "1";
      env.DASHBOARD_E2E_LIVE_GOAL_FIRST = "1";
      delete env.DASHBOARD_E2E_LIVE_PROJECT_ID;
      delete env.DASHBOARD_E2E_PROVIDER_FIXTURE;
      delete env.DASHBOARD_E2E_PROVIDER_FIXTURE_LOG;
      delete env.MISSION_E2E_PROVIDER_FIXTURE;
    } else {
      env.DASHBOARD_E2E_PROVIDER_FIXTURE = "1";
      env.DASHBOARD_E2E_PROVIDER_FIXTURE_LOG = providerLogPath;
      env.OPENROUTER_API_KEY = "engineering-agent-lifecycle-local-fixture";
      delete env.DASHBOARD_E2E_LIVE_PROVIDER;
      delete env.DASHBOARD_E2E_LIVE_DISPOSABLE;
      delete env.DASHBOARD_E2E_LIVE_CREATE_DISPOSABLE;
      delete env.DASHBOARD_E2E_LIVE_GOAL_FIRST;
    }
    if (lifecycleRun) {
      env.ENGINEERING_AGENT_LIFECYCLE_E2E = "1";
      env.ENGINEERING_AGENT_LIFECYCLE_REMOTE = lifecycleRemotePath;
      env.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT = lifecycleProjectRoot;
      env.ENGINEERING_AGENT_LIFECYCLE_RECEIPT = lifecycleReceiptPath;
      env.ENGINEERING_AGENT_LIFECYCLE_SOURCE_FINGERPRINT = lifecycleSourceFingerprint;
      env.ENGINEERING_AGENT_LIFECYCLE_RUN_ID = lifecycleRunId;
      env.ENGINEERING_AGENT_LIFECYCLE_STARTED_AT = lifecycleStartedAt;
      env.ENGINEERING_AGENT_LIFECYCLE_ENVIRONMENT_IDENTITY = lifecycleEnvironmentIdentity;
    } else {
      delete env.ENGINEERING_AGENT_LIFECYCLE_E2E;
      delete env.ENGINEERING_AGENT_LIFECYCLE_REMOTE;
      delete env.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT;
      delete env.ENGINEERING_AGENT_LIFECYCLE_RECEIPT;
      delete env.ENGINEERING_AGENT_LIFECYCLE_RUN_ID;
      delete env.ENGINEERING_AGENT_LIFECYCLE_STARTED_AT;
      delete env.ENGINEERING_AGENT_LIFECYCLE_ENVIRONMENT_IDENTITY;
    }
    delete env.AI_PROVIDER_EGRESS_DISABLED;

    const origins = new Set(
      (env.APP_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
    );
    if (env.REPLIT_DEV_DOMAIN) origins.add(`https://${env.REPLIT_DEV_DOMAIN}`);
    origins.add(`http://127.0.0.1:${dashboardPort}`);
    env.APP_ORIGINS = [...origins].join(",");

    await mkdir(dirname(providerLogPath), { recursive: true });
    await rm(providerLogPath, { force: true });

    console.log("Checking local provider fixture guards and response contracts.");
    lifecycleRunnerStage = "provider-fixture";
    await run("pnpm", ["run", "test:goal-first-provider-fixture"], { env });

    if (lifecycleRun) {
      lifecycleRunnerStage = "receipt-contract";
      await run("pnpm", ["run", "test:engineering-agent-lifecycle-receipt"], { env });
      lifecycleRunnerStage = "journey-contracts";
      await run("pnpm", ["run", "test:mission-correlation-report"], { env });
      await run("pnpm", ["run", "test:dashboard-journey-contract"], { env });
    }

    console.log("Applying the schema to an isolated loopback-only PostgreSQL cluster.");
    lifecycleRunnerStage = "database-schema";
    await run("pnpm", ["--filter", "@workspace/db", "run", "schema:apply"], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    if (lifecycleRun) {
      console.log("Verifying linked Episode writes preserve Mission/Goal-before-Execution lock order.");
      lifecycleRunnerStage = "episode-mission-execution-lock-order";
      await run("pnpm", [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "src/lib/agent-state/agent-episode-ledger.test.ts",
        "-t",
        "locks linked Mission and Goal before Execution when appending an Episode event",
      ], { env });
      if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

      console.log("Verifying legacy Mission lifecycle adapters use the current decision and shared idempotency ledger.");
      lifecycleRunnerStage = "mission-agent-compatibility-adapters";
      await run("pnpm", [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "src/routes/ai/missions.test.ts",
        "-t",
        "routes legacy Agent lifecycle requests through the decision and idempotency gates",
      ], { env });
      if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);
    }

    console.log("Verifying stale Mission plan confirmations against the isolated database.");
    lifecycleRunnerStage = "mission-plan-confirmation";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "rejects Mission creation when its reviewed plan hash is stale",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying Mission candidate acceptance before Apply Mission handoff.");
    lifecycleRunnerStage = "candidate-acceptance";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "blocks a Mission candidate until its current attempt has Canonical Proof",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying Apply Mission delivery dependency and compatibility gates.");
    lifecycleRunnerStage = "apply-mission-delivery-gate";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/lib/agent-state/apply-changes-mission-gate.test.ts",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying Apply D2 proof continuity after an exact Git commit.");
    lifecycleRunnerStage = "apply-d2-committed-proof";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/lib/mission-runtime-apply-changes.test.ts",
      "-t",
      "keeps D2 proof current after the exact candidate is committed",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying approved Mission delivery against the controlled local bare remote.");
    lifecycleRunnerStage = "delivery-service";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/lib/github-delivery-service.test.ts",
      "-t",
      "approved, committed candidate through the controlled local bare remote",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying AI-scoped commit identity and delivery through the isolated local remote.");
    lifecycleRunnerStage = "git-delivery-route";
    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/routes/git.test.ts",
      "-t",
      "keeps manual Git push outside AI World State and completes the approved delivery trace|derives a namespaced proposal operation identity for a scoped commit|preserves the leading porcelain column when showing a modified tracked file",
    ], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log(
      lifecycleRun
        ? "Running the authenticated correlated Engineering Agent lifecycle journey with a disposable local remote."
        : liveProviderRun
        ? "Running the live-provider goal-first journey against the real API and isolated loopback database."
        : "Running the goal-first browser journey against the real API and isolated database.",
    );
    lifecycleRunnerStage = "browser-journey";
    const journeyLogs = await run(
      "pnpm",
      ["run", "validate:dashboard-journey"],
      { env, capture: true },
    );

    if (lifecycleRun) {
      const receipt = JSON.parse(await readFile(lifecycleReceiptPath, "utf8"));
      if (
        receipt?.schemaVersion !== 1
        || receipt.status !== "passed"
        || receipt.stage !== "complete"
        || receipt.sourceFingerprint !== lifecycleSourceFingerprint
      ) {
        throw new Error(
          `Engineering Agent lifecycle did not complete: ${receipt?.stage ?? "receipt"} / ${receipt?.code ?? "invalid_receipt"} / source_fingerprint_mismatch=${receipt?.sourceFingerprint !== lifecycleSourceFingerprint}.`,
        );
      }
      const lifecycleKinds = new Set(
        (await readFile(providerLogPath, "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line).kind;
            } catch {
              return undefined;
            }
          })
          .filter(Boolean),
      );
      for (const expectedKind of [
        "lifecycle-write_file",
        "lifecycle-run_validation",
        "lifecycle-mission-final",
      ]) {
        if (!lifecycleKinds.has(expectedKind)) {
          throw new Error(`Lifecycle provider fixture did not observe ${expectedKind}.`);
        }
      }
      lifecycleRunnerStage = "independent-verifier";
      await run(
        "node",
        ["scripts/verify-engineering-agent-lifecycle-receipt.mjs", "--live"],
        { env },
      );
      return;
    }

    const providerLog = await readFile(providerLogPath, "utf8").catch(() => "");
    if (liveProviderRun) {
      if (providerLog.includes('"kind":"chat-completion"')) {
        throw new Error("The live-provider journey unexpectedly used the local chat fixture.");
      }
    } else {
    const usedLocalChatFixture = providerLog
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return JSON.parse(line).kind === "chat-completion";
        } catch {
          return false;
        }
      });
    if (!usedLocalChatFixture) {
      throw new Error("The goal did not reach the local provider fixture; refusing to count the journey as executed.");
    }
    const usedMissionReadToolCallFixture = providerLog
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return JSON.parse(line).kind === "mission-read-tool-call";
        } catch {
          return false;
        }
      });
    if (!usedMissionReadToolCallFixture) {
      throw new Error("The read-only Mission did not use the local read-tool fixture.");
    }
    const usedMissionEvidenceSynthesis = providerLog
      .split("\n")
      .filter(Boolean)
      .some((line) => {
        try {
          return JSON.parse(line).kind === "mission-evidence-synthesis";
        } catch {
          return false;
        }
      });
    if (!usedMissionEvidenceSynthesis) {
      throw new Error("The read-only Mission did not use the local evidence-synthesis fixture.");
    }
    }
    const serverLogs = `${journeyLogs.stdout}\n${journeyLogs.stderr}`;
    if (
      liveProviderRun &&
      !serverLogs.includes('"scope":"openai-compatible-client","action":"pre_fetch"')
    ) {
      throw new Error(
        "The live goal-first journey completed without an observed OpenRouter request attempt.",
      );
    }
    const observationProofs = serverLogs
      .split("\n")
      .flatMap((line) => {
        try {
          const record = JSON.parse(line);
          return record.scope === "mission-observation-proof" ? [record] : [];
        } catch {
          return [];
        }
      });
    const effectiveToolManifests = serverLogs
      .split("\n")
      .flatMap((line) => {
        try {
          const record = JSON.parse(line);
          return record.scope === "chat-agent"
            && record.code === "SINGLE_FILE_FORENSIC_EFFECTIVE_MANIFEST"
            ? [record]
            : [];
        } catch {
          return [];
        }
      });
    if (!effectiveToolManifests.some((manifest) =>
      manifest.completeReads === true
      && manifest.allowedTools?.length === 1
      && manifest.allowedTools[0] === "read_file"
    )) {
      throw new Error(
        "The goal-first Mission did not retain its server-owned read-only tool manifest.",
      );
    }
    if (!observationProofs.some((proof) =>
      proof.validatorAllowed === true
      && proof.sourceSnapshotComplete === true
      && proof.pendingChangeCount === 0
      && proof.provenClaimCount >= 5
      && proof.requiredClaimCount >= 5
      && proof.targetPathsInGraphReads >= 5
      && proof.targetPathsInResponseSources >= 5
    )) {
      throw new Error(
        "The goal-first run did not prove that all five requested source paths were read and returned as evidence.",
      );
    }
    const synthesisModelSelections = serverLogs
      .split("\n")
      .flatMap((line) => {
        try {
          const record = JSON.parse(line);
          return record.scope === "project-query-synthesis"
            && record.action === "model_selection"
            ? [record]
            : [];
        } catch {
          return [];
        }
      });
    if (!synthesisModelSelections.some((selection) =>
      typeof selection.loopModel === "string"
      && selection.loopModel !== "unknown"
      && selection.selectedModel === selection.loopModel
    )) {
      throw new Error(
        "Project-query synthesis did not reuse the model that successfully returned the tool-loop response.",
      );
    }
  } finally {
    await stopPostgres();
    if (lifecycleProjectRoot) {
      await rm(lifecycleProjectRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    if (lifecycleRun) {
      const receipt = JSON.parse(await readFile(lifecycleReceiptPath, "utf8").catch(() => "null"));
      if (receipt?.status === "passed") {
        lifecycleRunnerStage = "offline-verifier";
        const offlineEnv = isolatedDatabaseEnvironment();
        delete offlineEnv.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT;
        delete offlineEnv.ENGINEERING_AGENT_LIFECYCLE_REMOTE;
        await run(
          "node",
          [
            "scripts/verify-engineering-agent-lifecycle-receipt.mjs",
            "--offline",
            lifecycleReceiptPath,
            lifecycleOfflineVerificationPath,
          ],
          { env: offlineEnv },
        );
      }
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdownSignal = signal;
    activeChild?.kill(signal);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  void writeFallbackLifecycleReceipt()
    .catch(() => {})
    .finally(() => {
      process.exitCode = 1;
    });
});
