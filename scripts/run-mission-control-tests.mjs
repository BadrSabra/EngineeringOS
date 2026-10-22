import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "engineeringos-mission-control-pg-"));
const dataDirectory = path.join(temporaryRoot, "data");
const socketDirectory = path.join(temporaryRoot, "socket");
const logPath = path.join(temporaryRoot, "postgres.log");
const databaseUser = "mission_control_test";
const databaseName = "postgres";

let activeChild;
let initialized = false;
let shutdownSignal;

function onSignal(signal) {
  shutdownSignal = signal;
  activeChild?.kill(signal);
}

process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });
    activeChild = child;

    child.once("error", (error) => {
      activeChild = undefined;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      if (signal) {
        reject(new Error(`${command} was interrupted by ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`${command} exited with status ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Could not reserve a loopback PostgreSQL port.");
  }
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function isolatedDatabaseEnvironment(databaseUrl) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG") || key === "DATABASE_URL") delete env[key];
  }
  env.DATABASE_URL = databaseUrl;
  return env;
}

async function stopPostgres(port) {
  if (!initialized) return;
  try {
    await run("pg_ctl", [
      "-D", dataDirectory,
      "-m", "fast",
      "-w", "stop",
    ], {
      env: {
        ...isolatedDatabaseEnvironment(""),
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: databaseUser,
      },
    });
  } catch {
    // Cleanup remains best-effort if startup failed before pg_ctl could stop it.
  }
}

async function main() {
  if (os.userInfo().uid === 0) {
    throw new Error("Refusing to initialize the temporary PostgreSQL cluster as root.");
  }

  const port = await reserveLoopbackPort();
  const databaseUrl = `postgresql://${databaseUser}@127.0.0.1:${port}/${databaseName}`;
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
      "-o", `-h 127.0.0.1 -p ${port} -k ${socketDirectory} -c listen_addresses=127.0.0.1`,
      "-l", logPath,
      "-w", "start",
    ]);

    const databaseEnv = isolatedDatabaseEnvironment(databaseUrl);
    console.log("Applying the current database schema to an isolated loopback-only PostgreSQL cluster.");
    await run("pnpm", ["--filter", "@workspace/db", "run", "schema:apply"], {
      env: databaseEnv,
    });

    console.log("Simulating an existing Chat schema before the active Mission column was added.");
    await run("psql", [
      databaseUrl,
      "-v", "ON_ERROR_STOP=1",
      "-c", 'ALTER TABLE "ai_chat_sessions" DROP COLUMN IF EXISTS "active_mission_id"',
    ], {
      env: databaseEnv,
    });
    console.log("Applying the additive schema change to that existing database.");
    await run("pnpm", ["--filter", "@workspace/db", "run", "schema:apply"], {
      env: databaseEnv,
    });

    if (shutdownSignal) {
      throw new Error(`Test run interrupted by ${shutdownSignal}.`);
    }

    console.log("Running the isolated Mission Agent projection and action-gateway route tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "projects a safe empty-Mission state without creating runtime records|does not return an Engineering Agent projection to a non-owner|projects a pending Goal approval as the Mission's primary intervention|binds handoffs to the exact Chat message and resumes the persisted Agent-control projection|rejects active Mission selection without a handoff to the exact session and project|rolls back the Mission plan and handoff when persisting the session selection fails|replays a START action with the same idempotency key after the Mission decision changes|routes AUTO_CONTINUE through Mission Runtime and replays the accepted result|rolls back blocked AUTO_CONTINUE state when its action receipt cannot be written|routes RESUME through the recovery service and reissues a bound recovery capability on replay|routes RETRY through the retry service and replays a bound retry capability|keeps Task-owned (RESUME|RETRY) Executions on the Task recovery route|routes APPROVE through the plan-approval service and persists its approval boundary|routes REPLAN through the plan service and preserves one result for the same key|routes STOP through the cancellation service and records it idempotently|keeps REVIEW and NONE gateway branches non-mutating while recording their decisions|revalidates the current Mission decision after the action reservation is acquired|does not duplicate a business effect when ledger finalization fails after START is accepted|updates owned missions and goals while preserving project ownership|materializes an activation plan into durable steps when a mission becomes active",
    ], {
      env: databaseEnv,
    });

    console.log("Running the isolated unlinked Apply-Mission identity rejection test.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "rejects an unlinked Apply Mission even when the request tries to name its own canonical Mission",
    ], {
      env: databaseEnv,
    });

    console.log("Running isolated Mission completion delivery-requirement cases.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/mission-runtime.test.ts",
      "-t",
      "required delivery receipt|when delivery is not required",
    ], {
      env: databaseEnv,
    });

    console.log("Running delivery ambiguity and exact-retry recovery cases.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/github-delivery-races.integration.test.ts",
    ], {
      env: {
        ...databaseEnv,
        RUN_E2_GITHUB_DELIVERY_RACES: "1",
      },
    });

    console.log("Running isolated automatic-Mission-replan budget and concurrency tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/mission-auto-replan.test.ts",
      "src/lib/mission-auto-replan-evidence.integration.test.ts",
    ], {
      env: databaseEnv,
    });

    console.log("Running the five Mission Control route tests without live provider requests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/benchmark.test.ts",
      "-t", "GET /api/ai/mission-control",
    ], {
      env: databaseEnv,
    });

    console.log("Running the database-backed AI telemetry tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/ai-telemetry.test.ts",
    ], {
      env: databaseEnv,
    });

    console.log("Running provider-mocked AI route tests that persist telemetry.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai.test.ts",
      "-t",
      "recovers from malformed OpenRouter analysis output|recovers from malformed OpenRouter review output|makes malformed-then-429 review terminal",
    ], {
      env: databaseEnv,
    });
  } finally {
    await stopPostgres(port);
    await rm(temporaryRoot, { recursive: true, force: true });
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Mission Control tests failed.");
  process.exitCode = 1;
});
