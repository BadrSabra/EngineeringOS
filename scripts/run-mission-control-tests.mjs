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

    const focusedCase = process.env.MISSION_CONTINUITY_FOCUSED_CASE;
    if (focusedCase) {
      const cases = {
        "episode-world-revision": {
          file: "src/lib/agent-state/agent-episode-ledger.test.ts",
          test: "captures the scoped World State and environment revision before creating the Episode",
        },
        "mission-repair-episode-world-revision": {
          file: "src/lib/task-execution-lifecycle.integration.test.ts",
          test: "requires a directly observed candidate effect for an approved Mission repair",
        },
        "dependency-proof-diagnostics": {
          file: "src/lib/mission-runtime.test.ts",
          test: "releases a dependent Goal only from the matching current-attempt Canonical Proof|blocks dependency release when the proof has",
        },
        "recipe-dependency-proof-diagnostics": {
          file: "src/lib/mission-runtime-recipe.test.ts",
          test: "records dependency proof failures when a recipe finishes after its prerequisite proof becomes stale",
        },
        "recipe-taskless-materialization": {
          file: "src/routes/ai/missions.test.ts",
          test: "materializes an activation plan into durable steps when a mission becomes active",
        },
      };
      const selected = cases[focusedCase];
      if (!selected) {
        throw new Error(`Unknown Mission continuity focused test: ${focusedCase}`);
      }
      console.log(`Running isolated Mission continuity regression: ${focusedCase}.`);
      await run("pnpm", [
        "--filter", "@workspace/api-server",
        "exec", "vitest", "run",
        selected.file,
        "-t", selected.test,
      ], {
        env: databaseEnv,
      });
      return;
    }

    console.log("Running the isolated Mission Agent projection and action-gateway route tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "projects a safe empty-Mission state without creating runtime records|does not return an Engineering Agent projection to a non-owner|projects a pending Goal approval as the Mission's primary intervention|binds handoffs to the exact Chat message and resumes the persisted Agent-control projection|rejects active Mission selection without a handoff to the exact session and project|rolls back the Mission plan and handoff when persisting the session selection fails|replays a START action with the same idempotency key after the Mission decision changes|routes AUTO_CONTINUE through Mission Runtime and replays the accepted result|rolls back blocked AUTO_CONTINUE state when its action receipt cannot be written|routes RESUME through the recovery service and reissues a bound recovery capability on replay|routes RETRY through the retry service and replays a bound retry capability|keeps Task-owned (RESUME|RETRY) Executions on the Task recovery route|routes APPROVE through the plan-approval service and persists its approval boundary|routes REPLAN through the plan service and preserves one result for the same key|routes STOP through the cancellation service and records it idempotently|keeps REVIEW and NONE gateway branches non-mutating while recording their decisions|revalidates the current Mission decision after the action reservation is acquired|does not duplicate a business effect when ledger finalization fails after START is accepted|updates owned missions and goals while preserving project ownership|materializes an activation plan into durable steps when a mission becomes active|starts the activation plan during one active mission creation request",
    ], {
      env: databaseEnv,
    });

    console.log("Verifying Mission Episode World State capture and failed-check diagnostics.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/agent-state/agent-episode-ledger.test.ts",
      "-t", "captures the scoped World State and environment revision before creating the Episode",
    ], {
      env: databaseEnv,
    });
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/mission-runtime.test.ts",
      "-t", "blocks dependency release when the proof has a missing Episode World State revision",
    ], {
      env: databaseEnv,
    });
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/task-execution-lifecycle.integration.test.ts",
      "-t", "requires a directly observed candidate effect for an approved Mission repair",
    ], {
      env: databaseEnv,
    });
    console.log("Verifying Task and Recipe completion, retry, failure, and delivery boundaries.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/task-execution-lifecycle.integration.test.ts",
      "src/lib/mission-runtime-recipe.test.ts",
      "src/lib/recipe-operation-runner.test.ts",
      "src/routes/tasks.test.ts",
      "-t",
      "persists execution, checkpoint, task completion, and terminal acceptance"
        + "|rejects a stale retry generation or execution pointer before creating an execution"
        + "|rolls back task success projections when finalization fails after acceptance insert"
        + "|persists provider failure as retryable terminal acceptance"
        + "|records local task completion without completing the delivery Goal or Mission"
        + "|does not start a linked task when its completed Goal dependency has no current proof"
        + "|keeps Mission plan admission locked through a linked Task execution claim"
        + "|re-dispatches a queued Mission recipe after a process restart without duplicating its execution"
        + "|binds a typed recipe action to the existing recipe runner and projects completion"
        + "|prepares a candidate verification recipe with exactly one approved path"
        + "|returns an AI Task receipt only for the pointer-bound execution and exact attempt",
    ], {
      env: databaseEnv,
    });

    console.log("Proving the scoped lifecycle worker leaves another user's ready Goal untouched.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/lib/worker-scope.test.ts",
      "src/lib/mission-runtime-recipe.test.ts",
      "-t",
      "lifecycle worker project scope|releases a dependent Goal only after the GitHub delivery proof is current",
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

    console.log("Running isolated canonical Mission lineage and delivery-receipt tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "creates one server-bound Apply Mission for a prepared proposal and keeps its apply step taskless|fails closed on a legacy Apply Mission whose persisted lineage is missing|fails closed when the persisted Apply Mission link points to a different|rejects a delivery receipt that names a different canonical Mission|blocks a Mission candidate until its current attempt has Canonical Proof|rolls back the Mission and generated plan when a later transaction write fails|revalidates the complete Proposal identity after the handoff waits on its row lock|does not deadlock proposal handoff against approval locks and blocks an unaccepted candidate",
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
