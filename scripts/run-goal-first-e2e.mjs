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
      stdio: options.stdio ?? "inherit",
    });
    activeChild = child;
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (shutdownSignal) {
        rejectRun(new Error(`Interrupted by ${shutdownSignal}.`));
      } else if (code === 0) {
        resolveRun();
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
    env.DASHBOARD_E2E_TEST_MODE = "fixture";
    env.DASHBOARD_E2E_PROVIDER_FIXTURE = "1";
    env.DASHBOARD_E2E_GREP =
      "executes a real Mission Goal and reloads its durable non-proof result";
    env.DASHBOARD_E2E_BROWSER = process.env.DASHBOARD_E2E_BROWSER ?? "firefox";
    env.DASHBOARD_E2E_SKIP_API_CONTRACTS = "1";
    env.DASHBOARD_E2E_CHILD_TIMEOUT_MS = process.env.DASHBOARD_E2E_CHILD_TIMEOUT_MS ?? "240000";
    env.DASHBOARD_E2E_PROVIDER_FIXTURE_LOG = providerLogPath;
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

    console.log("Running the goal-first browser journey against the real API and isolated database.");
    await run("pnpm", ["run", "validate:dashboard-journey"], { env });

    const providerLog = await readFile(providerLogPath, "utf8").catch(() => "");
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
