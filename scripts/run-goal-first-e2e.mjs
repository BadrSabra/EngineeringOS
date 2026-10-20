import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUser = "goal_first_e2e";
const databaseName = "postgres";
const dashboardPort = Number(process.env.DASHBOARD_E2E_DASHBOARD_PORT ?? 23184);
const providerLogPath = resolve(
  workspaceRoot,
  "test-results/goal-first-e2e/provider-fixture-requests.jsonl",
);

let temporaryRoot = "";
let dataDirectory = "";
let socketDirectory = "";
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

async function main() {
  const liveProviderRun = process.env.GOAL_FIRST_LIVE_PROVIDER === "1";
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
    env.DASHBOARD_E2E_GREP = liveProviderRun
      ? "goal-first: cross-checks a read-only Mission across five files and reloads Canonical Proof"
      : "goal-first";
    env.DASHBOARD_E2E_BROWSER = process.env.DASHBOARD_E2E_BROWSER ?? "firefox";
    env.DASHBOARD_E2E_SKIP_API_CONTRACTS = "1";
    env.DASHBOARD_E2E_CHILD_TIMEOUT_MS = process.env.DASHBOARD_E2E_CHILD_TIMEOUT_MS ?? "240000";
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
      delete env.DASHBOARD_E2E_LIVE_PROVIDER;
      delete env.DASHBOARD_E2E_LIVE_DISPOSABLE;
      delete env.DASHBOARD_E2E_LIVE_CREATE_DISPOSABLE;
      delete env.DASHBOARD_E2E_LIVE_GOAL_FIRST;
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
    await run("pnpm", ["run", "test:goal-first-provider-fixture"], { env });

    console.log("Applying the schema to an isolated loopback-only PostgreSQL cluster.");
    await run("pnpm", ["--filter", "@workspace/db", "run", "schema:apply"], { env });
    if (shutdownSignal) throw new Error(`Interrupted by ${shutdownSignal}.`);

    console.log("Verifying stale Mission plan confirmations against the isolated database.");
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

    console.log("Verifying approved Mission delivery against the controlled local bare remote.");
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

    console.log(
      liveProviderRun
        ? "Running the live-provider goal-first journey against the real API and isolated loopback database."
        : "Running the goal-first browser journey against the real API and isolated database.",
    );
    const journeyLogs = await run(
      "pnpm",
      ["run", "validate:dashboard-journey"],
      { env, capture: true },
    );

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
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
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
  process.exitCode = 1;
});
