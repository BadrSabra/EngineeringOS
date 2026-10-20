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

    if (shutdownSignal) {
      throw new Error(`Test run interrupted by ${shutdownSignal}.`);
    }

    console.log("Running the owner-scoped Mission Agent projection route tests.");
    await run("pnpm", [
      "--filter", "@workspace/api-server",
      "exec", "vitest", "run",
      "src/routes/ai/missions.test.ts",
      "-t",
      "projects a safe empty-Mission state without creating runtime records|does not return an Engineering Agent projection to a non-owner|projects a pending Goal approval as the Mission's primary intervention",
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
