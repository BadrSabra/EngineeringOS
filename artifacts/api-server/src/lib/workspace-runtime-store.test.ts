import { promises as fs } from "node:fs";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createServer, request as requestOnSocket, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  workspaceRuntimeTable,
} from "@workspace/db";
import { resolveRuntimeListenerProcess } from "./agent-state/runtime-listener-process.js";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import {
  databaseWorkspaceRuntimeStore,
  createInMemoryWorkspaceRuntimeStore,
  RUNTIME_LEASE_MS,
} from "./workspace-runtime-store.js";
import {
  createWorkspaceRuntimeSupervisorStateVersion,
  WorkspaceRuntimeSupervisorClient,
} from "./workspace-runtime-supervisor-client.js";
import { startWorkspaceRuntimeSupervisorTestFixture } from "./workspace-runtime-supervisor-test-fixture.js";

const projectIds: string[] = [];
const roots: string[] = [];
const apiServerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRecoveryTestSecret = "runtime-start-response-loss-isolated-test-secret";

afterEach(async () => {
  const ownedProjectIds = projectIds.splice(0);
  await Promise.all(ownedProjectIds.map((projectId) =>
    db.delete(workspaceRuntimeTable).where(eq(workspaceRuntimeTable.projectId, projectId)),
  ));
  await Promise.all(ownedProjectIds.map((projectId) =>
    db.delete(projectsTable).where(eq(projectsTable.id, projectId)),
  ));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

interface RuntimeWorkerReadySignal {
  projectId: string;
  workerId: string;
  sessionId: string;
  status: string;
  pid: number;
  port: number;
  revision: string;
}

function requireDisposableRuntimeDatabaseUrl(): URL {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Runtime process-recovery test requires an explicit disposable DATABASE_URL.");
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || !/(?:disposable|test)/i.test(url.pathname)
  ) {
    throw new Error("Runtime process-recovery test accepts only a loopback disposable/test database.");
  }
  return url;
}

async function waitForRuntimeWorkerSignal(
  signalFile: string,
  child: ChildProcessWithoutNullStreams,
  output: () => string,
): Promise<RuntimeWorkerReadySignal> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await fs.readFile(signalFile, "utf8")) as RuntimeWorkerReadySignal;
      if (
        parsed.status === "running"
        && Number.isInteger(parsed.pid)
        && Number.isInteger(parsed.port)
        && parsed.sessionId
      ) {
        return parsed;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Runtime API worker exited before becoming ready; ${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the runtime API worker; ${output()}`);
}

async function waitForRuntimeWorkerDatabaseDisconnect(applicationName: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = ${applicationName}
    `);
    if (result.rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The killed runtime API worker still has a PostgreSQL session: ${applicationName}`);
}

async function fetchRuntimeFixture(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Runtime fixture returned HTTP ${response.status}.`);
  return response.text();
}

async function processGroupsForProjectRoot(projectRoot: string): Promise<number[]> {
  const entries = await fs.readdir("/proc");
  const processGroups = new Set<number>();
  await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map(async (pid) => {
    try {
      if (await fs.realpath(`/proc/${pid}/cwd`) !== projectRoot) return;
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      const processGroup = Number(fields[2]);
      if (Number.isInteger(processGroup) && processGroup > 1) processGroups.add(processGroup);
    } catch {
      // Processes can exit while /proc is being inspected.
    }
  }));
  return [...processGroups].sort((left, right) => left - right);
}

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Loopback fixture did not bind a TCP port.");
  }
  return address.port;
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  const port = await listenLoopback(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForJsonFile<T>(
  filePath: string,
  timeoutMs: number,
  description: string,
  output: () => string = () => "",
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}; ${output()}`);
}

async function waitForSupervisor(child: ChildProcess, socketPath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Isolated runtime supervisor exited before becoming ready.");
    }
    try {
      if ((await fs.lstat(socketPath)).isSocket()) return;
    } catch {
      // The isolated supervisor has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the isolated runtime supervisor Unix socket.");
}

async function stopProcess(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill(signal);
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function waitForApiWorkerReady(
  port: number,
  child: ChildProcessWithoutNullStreams,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API worker exited before healthz became ready; ${output()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
      await response.arrayBuffer();
    } catch {
      // The API is still in its startup sequence.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for API healthz; ${output()}`);
}

async function waitForRuntimePortFile(
  signalFile: string,
  launcher: ChildProcess,
): Promise<number> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const port = Number((await fs.readFile(signalFile, "utf8")).trim());
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (launcher.exitCode !== null || launcher.signalCode !== null) {
      throw new Error("The detached runtime launcher exited before reporting its listener port.");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the detached runtime listener port.");
}

async function stopDetachedRuntimeProcessGroup(pid: number, port?: number): Promise<void> {
  const send = (signal: NodeJS.Signals) => {
    if (pid === process.pid) throw new Error("Refusing to signal the test process as a runtime fixture.");
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      process.kill(pid, signal);
    }
  };
  send("SIGTERM");
  if (port) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        await fetchRuntimeFixture(port);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        return;
      }
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  send("SIGKILL");
}

describe("database workspace runtime store", () => {
  it("serializes active ownership and allows takeover only after release", async () => {
    const projectId = randomUUID();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-store-"));
    projectIds.push(projectId);
    roots.push(root);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-store-test-owner",
      name: "Runtime store test",
      rootPath: root,
      language: "typescript",
      status: "active",
    });

    const now = new Date();
    const first = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-a",
      revision: "revision-a",
      environmentRevision: null,
      workerId: "worker-a",
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    expect(first?.workerId).toBe("worker-a");

    const sameWorkerStart = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-a-concurrent",
      revision: "revision-a-concurrent",
      environmentRevision: null,
      workerId: "worker-a",
      now: new Date(now.getTime() + 500),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 500),
    });
    expect(sameWorkerStart).toBeUndefined();
    await expect(databaseWorkspaceRuntimeStore.get(projectId)).resolves.toMatchObject({
      sessionId: "session-a",
      workerId: "worker-a",
      status: "starting",
    });

    const blocked = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-b",
      revision: "revision-b",
      environmentRevision: null,
      workerId: "worker-b",
      now: new Date(now.getTime() + 1_000),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 1_000),
    });
    expect(blocked).toBeUndefined();

    await databaseWorkspaceRuntimeStore.releaseWorker("worker-a");
    const takeover = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-b",
      revision: "revision-b",
      environmentRevision: null,
      workerId: "worker-b",
      now: new Date(now.getTime() + 2_000),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 2_000),
    });
    expect(takeover?.workerId).toBe("worker-b");
    expect(takeover?.sessionId).toBe("session-b");
  });

  it("allows a fresh durable start after a proven failed start releases its lease", async () => {
    const projectId = randomUUID();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-failed-start-"));
    projectIds.push(projectId);
    roots.push(root);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-failed-start-test-owner",
      name: `Failed runtime start ${projectId.slice(0, 8)}`,
      rootPath: root,
      language: "typescript",
      status: "active",
    });

    const startedAt = new Date();
    const failedStart = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-failed-start",
      revision: "revision-before-failure",
      environmentRevision: null,
      workerId: "worker-failed-start",
      now: startedAt,
      leaseUntil: new Date(startedAt.getTime() + RUNTIME_LEASE_MS),
    });
    expect(failedStart).toBeDefined();
    if (!failedStart) throw new Error("The failed-start fixture was not persisted.");

    expect(await databaseWorkspaceRuntimeStore.updateOwnedSession(
      projectId,
      failedStart.sessionId,
      "worker-failed-start",
      {
        status: "failed",
        pid: null,
        port: null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        stoppedAt: new Date(),
        error: "Complete supervisor inventory found no runtime process.",
      },
      "starting",
    )).toBe(true);

    await expect(databaseWorkspaceRuntimeStore.get(projectId)).resolves.toMatchObject({
      sessionId: "session-failed-start",
      status: "failed",
      pid: null,
      port: null,
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    });

    const retry = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-after-failed-start",
      revision: "revision-after-retry",
      environmentRevision: null,
      workerId: "worker-after-failed-start",
      now: new Date(),
      leaseUntil: new Date(Date.now() + RUNTIME_LEASE_MS),
    });

    expect(retry).toMatchObject({
      sessionId: "session-after-failed-start",
      status: "starting",
      workerId: "worker-after-failed-start",
      pid: null,
      port: null,
    });
    expect(retry?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("rediscovers an expired runtime lease and grants only one recovery claim", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-store-recovery-test-owner",
      name: `Runtime recovery ${projectId.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
    });

    const now = new Date();
    const sessionId = `session-${randomUUID()}`;
    const first = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: "/tmp",
      sessionId,
      revision: "revision-recovery",
      environmentRevision: null,
      workerId: "worker-before-restart",
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    expect(first).toBeDefined();
    if (!first) throw new Error("Runtime fixture was not persisted.");
    expect(await databaseWorkspaceRuntimeStore.listRecoverable(now)).toEqual([]);

    const leaseExpiredAt = new Date(now.getTime() - 1);
    expect(await databaseWorkspaceRuntimeStore.updateOwnedSession(
      projectId,
      sessionId,
      "worker-before-restart",
      { leaseUntil: leaseExpiredAt },
    )).toBe(true);
    const recoverable = await databaseWorkspaceRuntimeStore.listRecoverable(now);
    expect(recoverable.map((runtime) => runtime.projectId)).toEqual([projectId]);

    const recovered = await databaseWorkspaceRuntimeStore.claimRecovery({
      id: first.id,
      sessionId,
      workerId: "worker-after-restart",
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    expect(recovered?.workerId).toBe("worker-after-restart");
    expect(await databaseWorkspaceRuntimeStore.claimRecovery({
      id: first.id,
      sessionId,
      workerId: "worker-late-contender",
      now: new Date(now.getTime() + 1),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 1),
    })).toBeUndefined();
    expect(await databaseWorkspaceRuntimeStore.listRecoverable(new Date(now.getTime() + 1))).toEqual([]);
  });

  it.skipIf(process.env.RUN_RUNTIME_CONCURRENT_START_PROCESS !== "1")(
    "starts different projects independently while same-project workers share one winning lease",
    async () => {
      const databaseUrl = requireDisposableRuntimeDatabaseUrl();
      const projectIdsForTest = [randomUUID(), randomUUID()];
      const [contendedProjectId, independentProjectId] = projectIdsForTest;
      const revisions = new Map([
        [contendedProjectId, `runtime-concurrent-${contendedProjectId}`],
        [independentProjectId, `runtime-independent-${independentProjectId}`],
      ]);
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-concurrent-api-workers-"));
      const projectRoots = new Map([
        [contendedProjectId, path.join(root, "project-a")],
        [independentProjectId, path.join(root, "project-b")],
      ]);
      const runtimeListenGate = path.join(root, "allow-runtime-listeners");
      const supervisorFixture = await startWorkspaceRuntimeSupervisorTestFixture({
        allowedRoots: [os.tmpdir()],
      });
      const supervisor = supervisorFixture.child;
      const barrierResponses: import("node:http").ServerResponse[] = [];
      const beginBarrier = createServer((_request, response) => {
        barrierResponses.push(response);
        if (barrierResponses.length === 3) {
          for (const waitingResponse of barrierResponses.splice(0)) {
            waitingResponse.writeHead(204);
            waitingResponse.end();
          }
        }
      });
      const workerProcesses: Array<{
        child: ChildProcessWithoutNullStreams;
        applicationName: string;
        workerId: string;
        projectId: string;
        readyFile: string;
        resultFile: string;
        output: () => string;
      }> = [];
      const runtimeSessions: Array<{ projectId: string; sessionId: string; pid: number | null }> = [];
      let releaseContendedProjectLock!: () => void;
      let signalContendedProjectLockAcquired!: () => void;
      const contendedProjectLockReleased = new Promise<void>((resolve) => {
        releaseContendedProjectLock = resolve;
      });
      const contendedProjectLockAcquired = new Promise<void>((resolve) => {
        signalContendedProjectLockAcquired = resolve;
      });
      let lockHolder: Promise<unknown> | undefined;
      projectIds.push(...projectIdsForTest);
      roots.push(root);

      try {
        for (const projectId of projectIdsForTest) {
          const projectRoot = projectRoots.get(projectId)!;
          const revision = revisions.get(projectId)!;
          await fs.mkdir(projectRoot, { recursive: true });
          await fs.writeFile(
            path.join(projectRoot, "package.json"),
            JSON.stringify({ private: true, scripts: { dev: "node server.mjs" } }),
            "utf8",
          );
          await fs.writeFile(
            path.join(projectRoot, "server.mjs"),
            [
              "import http from 'node:http';",
              "import fs from 'node:fs/promises';",
              `const launchSignalPath = ${JSON.stringify(path.join(root, `runtime-${projectId}.json`))};`,
              `const listenGatePath = ${JSON.stringify(runtimeListenGate)};`,
              "await fs.writeFile(launchSignalPath, JSON.stringify({ port: Number(process.env.PORT) }));",
              "while (true) {",
              "  try { await fs.access(listenGatePath); break; }",
              "  catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }",
              "}",
              `const server = http.createServer((_request, response) => response.end(${JSON.stringify(revision)}));`,
              "server.listen(Number(process.env.PORT), '127.0.0.1');",
              "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
            ].join("\n"),
            "utf8",
          );
          await db.insert(projectsTable).values({
            id: projectId,
            ownerId: "runtime-concurrent-api-worker-test",
            name: `Concurrent runtime ${projectId.slice(0, 8)}`,
            rootPath: projectRoot,
            language: "javascript",
            status: "active",
          });
        }

        lockHolder = db.transaction(async (tx) => {
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(
                ${contendedProjectId},
                hashtext('workspace-runtime-start')::bigint
              )
            )
          `);
          signalContendedProjectLockAcquired();
          await contendedProjectLockReleased;
        });
        await contendedProjectLockAcquired;

        const barrierPort = await listenLoopback(beginBarrier);
        await waitForSupervisor(supervisor, supervisorFixture.socketPath);

        const workerSpecs = [
          { suffix: "a", projectId: contendedProjectId },
          { suffix: "b", projectId: contendedProjectId },
          { suffix: "c", projectId: independentProjectId },
        ];
        for (const { suffix, projectId } of workerSpecs) {
          const projectRoot = projectRoots.get(projectId)!;
          const revision = revisions.get(projectId)!;
          const applicationName = `runtime-race-${suffix}-${projectId.slice(0, 8)}`;
          const workerId = `runtime-api-worker-${suffix}:${projectId}`;
          const readyFile = path.join(root, `${suffix}-ready.json`);
          const resultFile = path.join(root, `${suffix}-result.json`);
          const childDatabaseUrl = new URL(databaseUrl.toString());
          childDatabaseUrl.searchParams.set("application_name", applicationName);
          const source = [
            "(async () => {",
            '  const fs = await import("node:fs/promises");',
            '  const { WorkspaceRuntimeManager } = await import("./src/lib/workspace-runtime.ts");',
            '  const { databaseWorkspaceRuntimeStore } = await import("./src/lib/workspace-runtime-store.ts");',
            '  const { WorkspaceRuntimeSupervisorClient } = await import("./src/lib/workspace-runtime-supervisor-client.ts");',
            "  const projectId = process.env.RUNTIME_TEST_PROJECT_ID;",
            "  const projectRoot = process.env.RUNTIME_TEST_PROJECT_ROOT;",
            "  const revision = process.env.RUNTIME_TEST_REVISION;",
            "  const workerId = process.env.RUNTIME_TEST_WORKER_ID;",
            "  const readyFile = process.env.RUNTIME_TEST_READY_FILE;",
            "  const goFile = process.env.RUNTIME_TEST_GO_FILE;",
            "  const resultFile = process.env.RUNTIME_TEST_RESULT_FILE;",
            "  const barrierUrl = process.env.RUNTIME_TEST_BARRIER_URL;",
            "  const supervisorSocketPath = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH;",
            "  if (!projectId || !projectRoot || !revision || !workerId || !readyFile || !goFile || !resultFile || !barrierUrl || !supervisorSocketPath) throw new Error('Concurrent runtime worker configuration is incomplete.');",
            "  const store = {",
            "    ...databaseWorkspaceRuntimeStore,",
            "    async begin(input) {",
            "      const response = await fetch(barrierUrl, { method: 'POST' });",
            "      if (!response.ok) throw new Error(`Start barrier returned HTTP ${response.status}.`);",
            "      const claimed = await databaseWorkspaceRuntimeStore.begin(input);",
            "      await fs.writeFile(`${resultFile}.claim`, JSON.stringify({",
            "        workerId, claimed: Boolean(claimed), sessionId: claimed?.sessionId ?? null,",
            "      }), 'utf8');",
            "      return claimed;",
            "    },",
            "  };",
            "  const manager = new WorkspaceRuntimeManager({",
            "    store, workerId, heartbeatIntervalMs: 1000,",
            "    supervisor: new WorkspaceRuntimeSupervisorClient(),",
            "  });",
            "  process.once('SIGTERM', () => {",
            "    void manager.shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });",
            "  });",
            "  await fs.writeFile(readyFile, JSON.stringify({ workerId }));",
            "  while (true) {",
            "    try { await fs.access(goFile); break; }",
            "    catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise((resolve) => setTimeout(resolve, 10)); }",
            "  }",
            "  const started = await manager.start({ projectId, projectRoot, revision });",
            "  const row = await databaseWorkspaceRuntimeStore.get(projectId);",
            "  await fs.writeFile(resultFile, JSON.stringify({",
            "    workerId, started, rowWorkerId: row?.workerId ?? null, rowSessionId: row?.sessionId ?? null,",
            "    rowProjectRoot: row?.projectRoot ?? null,",
            "  }), 'utf8');",
            "  await new Promise(() => {});",
            "})().catch((error) => { console.error(error); process.exitCode = 1; });",
          ].join("\n");
          const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
            cwd: apiServerRoot,
            env: {
              DATABASE_URL: childDatabaseUrl.toString(),
              PGAPPNAME: applicationName,
              NODE_ENV: "test",
              SESSION_SECRET: runtimeRecoveryTestSecret,
              ...supervisorFixture.clientEnvironment,
              PATH: process.env.PATH ?? "",
              HOME: process.env.HOME ?? os.tmpdir(),
              AI_PROVIDER_EGRESS_DISABLED: "1",
              RUNTIME_TEST_PROJECT_ID: projectId,
              RUNTIME_TEST_PROJECT_ROOT: projectRoot,
              RUNTIME_TEST_REVISION: revision,
              RUNTIME_TEST_WORKER_ID: workerId,
              RUNTIME_TEST_READY_FILE: readyFile,
              RUNTIME_TEST_GO_FILE: path.join(root, "go"),
              RUNTIME_TEST_RESULT_FILE: resultFile,
              RUNTIME_TEST_BARRIER_URL: `http://127.0.0.1:${barrierPort}/begin`,
            },
            stdio: ["pipe", "pipe", "pipe"],
          });
          child.stdin.end();
          let output = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            output = `${output}${chunk}`.slice(-12_000);
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            output = `${output}${chunk}`.slice(-12_000);
          });
          workerProcesses.push({
            child,
            applicationName,
            workerId,
            projectId,
            readyFile,
            resultFile,
            output: () => output,
          });
        }

        await Promise.all(workerProcesses.map(({ readyFile, child, output }) =>
          waitForJsonFile<{ workerId: string }>(
            readyFile,
            30_000,
            "all API workers to be ready at the simultaneous-start barrier",
            () => `worker=${child.pid}; ${output()}`,
          ),
        ));
        await fs.writeFile(path.join(root, "go"), "start");

        const independentWorker = workerProcesses.find(({ projectId }) => projectId === independentProjectId)!;
        const independentClaim = await waitForJsonFile<{
          workerId: string;
          claimed: boolean;
          sessionId: string | null;
        }>(
          `${independentWorker.resultFile}.claim`,
          30_000,
          "the independent project's claim to complete while the other project's lock is held",
          independentWorker.output,
        );
        expect(independentClaim).toMatchObject({
          workerId: independentWorker.workerId,
          claimed: true,
        });

        const contendingWorkers = workerProcesses.filter(({ projectId }) => projectId === contendedProjectId);
        const advisoryWaitDeadline = Date.now() + 15_000;
        let advisoryWaiters: string[] = [];
        while (Date.now() < advisoryWaitDeadline) {
          const waitingWorkers = await Promise.all(contendingWorkers.map(async ({ applicationName }) => {
            const result = await db.execute(sql`
              SELECT application_name
              FROM pg_stat_activity
              WHERE application_name = ${applicationName}
                AND wait_event_type = 'Lock'
                AND wait_event = 'advisory'
            `);
            return result.rows.length > 0 ? applicationName : undefined;
          }));
          advisoryWaiters = waitingWorkers.filter((applicationName): applicationName is string => Boolean(applicationName));
          if (advisoryWaiters.length === contendingWorkers.length) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(advisoryWaiters.sort()).toEqual(contendingWorkers.map(({ applicationName }) => applicationName).sort());
        for (const { resultFile } of contendingWorkers) {
          await expect(fs.access(`${resultFile}.claim`)).rejects.toMatchObject({ code: "ENOENT" });
        }
        releaseContendedProjectLock();
        await lockHolder;

        const runtimeLaunchSignals = await Promise.all(projectIdsForTest.map((projectId) =>
          waitForJsonFile<{ port: number }>(
            path.join(root, `runtime-${projectId}.json`),
            30_000,
            `the runtime process for project ${projectId} to reserve its listener`,
          ),
        ));
        expect(new Set(runtimeLaunchSignals.map(({ port }) => port)).size).toBe(projectIdsForTest.length);
        await fs.writeFile(runtimeListenGate, "listen");

        const results = await Promise.all(workerProcesses.map(({ resultFile, child, output }) =>
          waitForJsonFile<{
            workerId: string;
            started: { projectId: string; sessionId: string | null; status: string; pid: number | null; port: number | null };
            rowWorkerId: string | null;
            rowSessionId: string | null;
            rowProjectRoot: string | null;
          }>(
            resultFile,
            60_000,
            "all API workers to return from their concurrent starts",
            () => `worker=${child.pid}; ${output()}`,
          ),
        ));
        const claims = await Promise.all(workerProcesses.map(({ resultFile, child, output }) =>
          waitForJsonFile<{ workerId: string; claimed: boolean; sessionId: string | null }>(
            `${resultFile}.claim`,
            30_000,
            "all API workers to finish their durable ownership claim",
            () => `worker=${child.pid}; ${output()}`,
          ),
        ));
        expect(results.map(({ workerId }) => workerId).sort()).toEqual(
          workerProcesses.map(({ workerId }) => workerId).sort(),
        );
        const winningContendedClaim = claims.filter(({ claimed, workerId }) =>
          claimed && contendingWorkers.some(({ workerId: contenderId }) => contenderId === workerId),
        );
        const independentClaims = claims.filter(({ claimed, workerId }) =>
          claimed && workerProcesses.some(({ projectId, workerId: specWorkerId }) =>
            projectId === independentProjectId && specWorkerId === workerId,
          ),
        );
        expect(winningContendedClaim).toHaveLength(1);
        expect(independentClaims).toHaveLength(1);

        const persistedRows = new Map<string, NonNullable<Awaited<ReturnType<typeof databaseWorkspaceRuntimeStore.get>>>>();
        for (const projectId of projectIdsForTest) {
          let persisted = await databaseWorkspaceRuntimeStore.get(projectId);
          const runningDeadline = Date.now() + 30_000;
          while (persisted?.status !== "running" && Date.now() < runningDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            persisted = await databaseWorkspaceRuntimeStore.get(projectId);
          }
          expect(persisted).toMatchObject({
            projectId,
            projectRoot: projectRoots.get(projectId),
            status: "running",
            workerId: expect.any(String),
            sessionId: expect.any(String),
            revision: revisions.get(projectId),
            pid: expect.any(Number),
            port: expect.any(Number),
            leaseUntil: expect.any(Date),
          });
          expect(persisted?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
          if (!persisted) throw new Error(`Runtime row for project ${projectId} was not persisted.`);
          persistedRows.set(projectId, persisted);
          runtimeSessions.push({
            projectId,
            sessionId: persisted.sessionId,
            pid: persisted.pid,
          });

          const projectWorkers = workerProcesses.filter(({ projectId: workerProjectId }) => workerProjectId === projectId);
          const projectResults = results.filter(({ workerId }) => projectWorkers.some(({ workerId: specWorkerId }) => specWorkerId === workerId));
          expect(new Set(projectResults.map(({ started }) => started.sessionId)).size).toBe(1);
          expect(projectResults.every(({ rowWorkerId, rowSessionId, rowProjectRoot }) =>
            rowWorkerId === persisted!.workerId
            && rowSessionId === persisted!.sessionId
            && rowProjectRoot === projectRoots.get(projectId),
          )).toBe(true);
          expect(claims.find(({ workerId }) => workerId === persisted!.workerId)).toMatchObject({
            claimed: true,
            sessionId: persisted.sessionId,
          });
          expect(workerProcesses.find(({ workerId }) => workerId === persisted!.workerId)).toBeDefined();

          expect(process.kill(-persisted.pid!, 0)).toBe(true);
          expect(await processGroupsForProjectRoot(projectRoots.get(projectId)!)).toEqual([persisted.pid]);
          expect(await fetchRuntimeFixture(persisted.port!)).toBe(revisions.get(projectId));
        }
        expect(persistedRows.get(contendedProjectId)?.workerId).not.toBe(persistedRows.get(independentProjectId)?.workerId);
        expect(persistedRows.get(contendedProjectId)?.sessionId).not.toBe(persistedRows.get(independentProjectId)?.sessionId);
        expect(persistedRows.get(contendedProjectId)?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(persistedRows.get(independentProjectId)?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
      } finally {
        releaseContendedProjectLock();
        await fs.writeFile(runtimeListenGate, "cleanup").catch(() => undefined);
        await lockHolder?.catch(() => undefined);
        for (const runtimeSession of runtimeSessions) {
          const persistedSession = await databaseWorkspaceRuntimeStore.get(runtimeSession.projectId);
          if (persistedSession?.startedAt) {
            await new WorkspaceRuntimeSupervisorClient(
              supervisorFixture.socketPath,
              supervisorFixture.signingPrivateKeyBase64,
            ).stop({
              projectId: runtimeSession.projectId,
              sessionId: runtimeSession.sessionId,
              stateVersion: createWorkspaceRuntimeSupervisorStateVersion({
                projectId: runtimeSession.projectId,
                sessionId: runtimeSession.sessionId,
                revision: persistedSession.revision,
                startedAt: persistedSession.startedAt.toISOString(),
              }),
              pid: runtimeSession.pid,
            }).catch(() => undefined);
          }
        }
        await Promise.all(workerProcesses.map(async ({ child, applicationName }) => {
          if (child.exitCode === null && child.signalCode === null) await stopProcess(child);
          await waitForRuntimeWorkerDatabaseDisconnect(applicationName).catch(() => undefined);
        }));
        for (const response of barrierResponses.splice(0)) {
          if (!response.destroyed) response.destroy();
        }
        if (beginBarrier.listening) {
          await new Promise<void>((resolve) => beginBarrier.close(() => resolve()));
        }
        await supervisorFixture.stop();
      }
    },
    120_000,
  );

  it.skipIf(process.env.RUN_RUNTIME_ADOPTION_PROCESS_RECOVERY !== "1")(
    "rehydrates a live runtime after the owning API worker is SIGKILLed",
    async () => {
      const databaseUrl = requireDisposableRuntimeDatabaseUrl();
      const projectId = randomUUID();
      const revision = "runtime-adoption-revision";
      const workerId = `runtime-api-worker-before-${projectId}`;
      const applicationName = `runtime-api-${projectId.slice(0, 20)}`;
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-adoption-process-"));
      const readyFile = path.join(root, "worker-ready.json");
      projectIds.push(projectId);
      roots.push(root);

      let worker: ChildProcessWithoutNullStreams | undefined;
      let workerExit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
      let recoveryManager: WorkspaceRuntimeManager | undefined;
      let ready: RuntimeWorkerReadySignal | undefined;

      try {
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "runtime-adoption-process-test-owner",
          name: `Runtime adoption ${projectId.slice(0, 8)}`,
          rootPath: root,
          language: "typescript",
          status: "active",
        });
        await fs.writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ scripts: { dev: "node server.mjs" } }),
        );
        await fs.writeFile(
          path.join(root, "server.mjs"),
          [
            "import http from 'node:http';",
            `const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', '${revision}'); res.end('runtime-adoption-live'); });`,
            "server.listen(Number(process.env.PORT), '127.0.0.1');",
            "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
          ].join("\n"),
        );

        const childDatabaseUrl = new URL(databaseUrl.toString());
        childDatabaseUrl.searchParams.set("application_name", applicationName);
        const source = [
          "(async () => {",
          '  const { promises: fs } = await import("node:fs");',
          '  const { WorkspaceRuntimeManager } = await import("./src/lib/workspace-runtime.ts");',
          '  const { databaseWorkspaceRuntimeStore } = await import("./src/lib/workspace-runtime-store.ts");',
          "  const projectId = process.env.RUNTIME_ADOPTION_PROJECT_ID;",
          "  const projectRoot = process.env.RUNTIME_ADOPTION_PROJECT_ROOT;",
          "  const workerId = process.env.RUNTIME_ADOPTION_WORKER_ID;",
          "  const readyFile = process.env.RUNTIME_ADOPTION_READY_FILE;",
          "  if (!projectId || !projectRoot || !workerId || !readyFile) throw new Error('Runtime worker fixture configuration is incomplete.');",
          "  const revision = 'runtime-adoption-revision';",
          "  const manager = new WorkspaceRuntimeManager({ store: databaseWorkspaceRuntimeStore, workerId });",
          "  const started = await manager.start({",
          "    projectId, projectRoot, revision,",
          "    attestationIdentity: {",
          "      projectId, operationId: 'runtime-adoption-operation',",
          "      executionId: 'runtime-adoption-execution', executionAttempt: 1,",
          "      episodeId: 'runtime-adoption-episode', revision,",
          "    },",
          "  });",
          "  if (started.status !== 'running' || !started.sessionId || !started.pid || !started.port) throw new Error('Runtime worker did not start a complete session.');",
          "  const signal = { projectId, workerId, sessionId: started.sessionId, status: started.status, pid: started.pid, port: started.port, revision };",
          "  const temporarySignalFile = `${readyFile}.tmp`;",
          "  await fs.writeFile(temporarySignalFile, JSON.stringify(signal), 'utf8');",
          "  await fs.rename(temporarySignalFile, readyFile);",
          "  await new Promise(() => {});",
          "})().catch((error) => { console.error(error); process.exitCode = 1; });",
        ].join("\n");
        let stdout = "";
        let stderr = "";
        const childEnvironment: NodeJS.ProcessEnv = {
          DATABASE_URL: childDatabaseUrl.toString(),
          PGAPPNAME: applicationName,
          NODE_ENV: "test",
          SESSION_SECRET: runtimeRecoveryTestSecret,
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? os.tmpdir(),
          AI_PROVIDER_EGRESS_DISABLED: "1",
          RUNTIME_ADOPTION_PROJECT_ID: projectId,
          RUNTIME_ADOPTION_PROJECT_ROOT: root,
          RUNTIME_ADOPTION_WORKER_ID: workerId,
          RUNTIME_ADOPTION_READY_FILE: readyFile,
        };
        const spawnedWorker = spawn(process.execPath, ["--import", "tsx", "-e", source], {
          cwd: process.cwd(),
          env: childEnvironment,
          stdio: "pipe",
        });
        worker = spawnedWorker;
        spawnedWorker.stdin.end();
        spawnedWorker.stdout.setEncoding("utf8");
        spawnedWorker.stderr.setEncoding("utf8");
        spawnedWorker.stdout.on("data", (chunk: string) => {
          stdout = `${stdout}${chunk}`.slice(-12_000);
        });
        spawnedWorker.stderr.on("data", (chunk: string) => {
          stderr = `${stderr}${chunk}`.slice(-12_000);
        });
        workerExit = new Promise((resolve) => {
          spawnedWorker.once("exit", (code, signal) => resolve({ code, signal }));
        });
        ready = await waitForRuntimeWorkerSignal(
          readyFile,
          spawnedWorker,
          () => `stdout=${stdout}; stderr=${stderr}`,
        );
        expect(ready).toMatchObject({
          projectId,
          workerId,
          status: "running",
          revision,
        });
        const persisted = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(persisted).toMatchObject({
          sessionId: ready.sessionId,
          workerId,
          status: "running",
          pid: ready.pid,
          port: ready.port,
          revision,
          attestationBinding: {
            projectId,
            sessionId: ready.sessionId,
            executionId: "runtime-adoption-execution",
            executionAttempt: 1,
            episodeId: "runtime-adoption-episode",
            operationId: "runtime-adoption-operation",
            revision,
          },
          attestationKeyVersion: "runtime-child-marker-hmac-v1",
        });

        spawnedWorker.kill("SIGKILL");
        const killedWorker = await workerExit;
        expect(killedWorker.signal).toBe("SIGKILL");
        await waitForRuntimeWorkerDatabaseDisconnect(applicationName);
        expect(await fetchRuntimeFixture(ready.port)).toBe("runtime-adoption-live");

        expect(await databaseWorkspaceRuntimeStore.updateOwnedSession(
          projectId,
          ready.sessionId,
          workerId,
          {
            leaseUntil: new Date(Date.now() - 1),
            lastHeartbeatAt: new Date(Date.now() - RUNTIME_LEASE_MS - 1),
          },
        )).toBe(true);

        let listenerOwnership: "unknown" | "known" = "unknown";
        const listenerResolutions: Array<{
          launchPid: number | null | undefined;
          port: number;
          bindingDigest: string | null | undefined;
        }> = [];
        const supervisorAdoptions: Array<{
          projectId: string;
          sessionId: string;
          projectRoot: string;
          pid: number | null;
          port: number | null;
          listenerBindingDigest: string;
          expectedListenerIdentityDigest: string;
          markerProvided: boolean;
        }> = [];
        const supervisorFixture = {
          async adopt(input: {
            projectId: string;
            sessionId: string;
            projectRoot: string;
            pid: number | null;
            port: number | null;
            listenerBindingDigest: string;
            expectedListenerIdentityDigest: string;
            attestationMarker?: string;
          }) {
            supervisorAdoptions.push({
              projectId: input.projectId,
              sessionId: input.sessionId,
              projectRoot: input.projectRoot,
              pid: input.pid,
              port: input.port,
              listenerBindingDigest: input.listenerBindingDigest,
              expectedListenerIdentityDigest: input.expectedListenerIdentityDigest,
              markerProvided: Boolean(input.attestationMarker),
            });
            return {
              projectId: input.projectId,
              sessionId: input.sessionId,
              status: "running" as const,
              pid: input.pid,
              port: input.port,
              listenerIdentityDigest: input.expectedListenerIdentityDigest,
              logs: ["re-adopted by isolated supervisor fixture"],
            };
          },
        };
        recoveryManager = new WorkspaceRuntimeManager({
          store: databaseWorkspaceRuntimeStore,
          workerId: `runtime-api-worker-after-${projectId}`,
          attestationSecret: runtimeRecoveryTestSecret,
          heartbeatIntervalMs: 60_000,
          supervisor: supervisorFixture as never,
          listenerResolver: async ({ launchPid, port, bindingDigest }) => {
            listenerResolutions.push({ launchPid, port, bindingDigest });
            if (
              listenerOwnership === "known"
              && launchPid === ready!.pid
              && port === ready!.port
            ) {
              return {
                status: "known" as const,
                reasonCode: "listener_owned_by_runtime_process" as const,
                port,
                pid: launchPid,
                identityDigest: bindingDigest ?? null,
                observedAt: new Date().toISOString(),
              };
            }
            return {
              status: "unknown" as const,
              reasonCode: "listener_not_in_runtime_tree" as const,
              port: null,
              pid: null,
              identityDigest: null,
              observedAt: new Date().toISOString(),
            };
          },
        });

        await recoveryManager.recover(projectId);
        let recoveredRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(recoveredRow).toMatchObject({
          status: "running",
          workerId: null,
          leaseUntil: null,
          pid: ready.pid,
          port: ready.port,
          sessionId: ready.sessionId,
        });
        expect(supervisorAdoptions).toHaveLength(0);
        expect(await fetchRuntimeFixture(ready.port)).toBe("runtime-adoption-live");

        listenerOwnership = "known";
        await recoveryManager.recover(projectId);
        recoveredRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(recoveredRow).toMatchObject({
          status: "running",
          workerId: `runtime-api-worker-after-${projectId}`,
          pid: ready.pid,
          port: ready.port,
          sessionId: ready.sessionId,
        });
        expect(recoveredRow?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(supervisorAdoptions).toHaveLength(1);
        expect(supervisorAdoptions[0]).toMatchObject({
          projectId,
          sessionId: ready.sessionId,
          projectRoot: root,
          pid: ready.pid,
          port: ready.port,
          listenerBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          expectedListenerIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          markerProvided: true,
        });
        expect(listenerResolutions).toHaveLength(3);
        expect(listenerResolutions.every(({ bindingDigest }) =>
          typeof bindingDigest === "string" && /^[a-f0-9]{64}$/.test(bindingDigest),
        )).toBe(true);
        const recoveredProof = await recoveryManager.observeAfterState({
          projectId,
          sessionId: ready.sessionId,
          revision,
          attestationBinding: recoveredRow!.attestationBinding!,
        });
        expect(recoveredProof).toMatchObject({
          status: "passed",
          sessionId: ready.sessionId,
          revision,
          processAlive: true,
          portReady: true,
          childProcessAttestation: {
            status: "known",
            reasonCode: "child_process_observed",
          },
          listener: {
            status: "known",
            processAttestation: {
              status: "known",
              reasonCode: "child_process_observed",
            },
          },
        });
        expect(await recoveryManager.get(projectId)).toMatchObject({
          status: "running",
          sessionId: ready.sessionId,
          pid: ready.pid,
          port: ready.port,
        });
        expect(await fetchRuntimeFixture(ready.port)).toBe("runtime-adoption-live");
      } finally {
        if (worker && worker.exitCode === null && worker.signalCode === null) {
          worker.kill("SIGKILL");
          if (workerExit) await workerExit;
        }
        if (recoveryManager) await recoveryManager.shutdown({ preserveProcesses: true });
        const persisted = await databaseWorkspaceRuntimeStore.get(projectId);
        const runtimePid = ready?.pid ?? persisted?.pid;
        const runtimePort = ready?.port ?? persisted?.port;
        if (runtimePid) await stopDetachedRuntimeProcessGroup(runtimePid, runtimePort ?? undefined);
        await db.delete(workspaceRuntimeTable).where(eq(workspaceRuntimeTable.projectId, projectId));
      }
    },
    120_000,
  );
});

describe("workspace runtime lost-start-response process recovery", () => {
  it.skipIf(process.env.RUN_RUNTIME_START_RESPONSE_LOSS_RECOVERY !== "1")(
    "recovers the supervisor-created session after the API worker dies before receiving its start reply",
    async () => {
      const databaseUrl = requireDisposableRuntimeDatabaseUrl();
      const projectId = randomUUID();
      const revision = `runtime-response-loss-${projectId}`;
      const startWorkerId = `runtime-response-loss-start:${projectId}`;
      const recoveryWorkerId = `runtime-response-loss-recovery:${projectId}`;
      const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-start-response-loss-"));
      const projectRoot = path.join(testRoot, "project");
      const supervisorResultPath = path.join(testRoot, "supervisor-start-result.json");
      const recoveryResultPath = path.join(testRoot, "recovered-runtime.json");
      projectIds.push(projectId);
      roots.push(testRoot);

      const supervisorFixture = await startWorkspaceRuntimeSupervisorTestFixture({
        allowedRoots: [os.tmpdir()],
      });
      const supervisor = supervisorFixture.child;
      const proxySocketPath = path.join(testRoot, "supervisor-proxy.sock");
      let proxy: Server | undefined;
      let startApiWorker: ChildProcessWithoutNullStreams | undefined;
      let recoveryApiWorker: ChildProcessWithoutNullStreams | undefined;
      let releaseHeldStartReply: (() => void) | undefined;
      let startRequestCount = 0;
      let startReply: { projectId: string; sessionId: string; status: string; pid: number; port: number } | undefined;
      const supervisorClient = new WorkspaceRuntimeSupervisorClient(
        supervisorFixture.socketPath,
        supervisorFixture.signingPrivateKeyBase64,
      );

      const spawnApiWorker = (
        mode: "start" | "recover",
        workerId: string,
        applicationName: string,
        supervisorSocketPath: string,
        resultPath: string,
      ): ChildProcessWithoutNullStreams => {
        const childDatabaseUrl = new URL(databaseUrl.toString());
        childDatabaseUrl.searchParams.set("application_name", applicationName);
        const source = [
          "(async () => {",
          '  const fs = await import("node:fs/promises");',
          '  const { WorkspaceRuntimeManager } = await import("./src/lib/workspace-runtime.ts");',
          '  const { databaseWorkspaceRuntimeStore } = await import("./src/lib/workspace-runtime-store.ts");',
          '  const { WorkspaceRuntimeSupervisorClient } = await import("./src/lib/workspace-runtime-supervisor-client.ts");',
          "  const projectId = process.env.RUNTIME_TEST_PROJECT_ID;",
          "  const projectRoot = process.env.RUNTIME_TEST_PROJECT_ROOT;",
          "  const revision = process.env.RUNTIME_TEST_REVISION;",
          "  const workerId = process.env.RUNTIME_TEST_WORKER_ID;",
          "  const resultPath = process.env.RUNTIME_TEST_RESULT_PATH;",
          "  const mode = process.env.RUNTIME_TEST_MODE;",
          "  const supervisorSocketPath = process.env.WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH;",
          "  if (!projectId || !projectRoot || !revision || !workerId || !resultPath || !supervisorSocketPath) throw new Error('Runtime recovery worker configuration is incomplete.');",
          "  const manager = new WorkspaceRuntimeManager({",
          "    store: databaseWorkspaceRuntimeStore, workerId, heartbeatIntervalMs: 1000,",
          "    supervisor: new WorkspaceRuntimeSupervisorClient(),",
          "  });",
          "  process.once('SIGTERM', () => {",
          "    void manager.shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });",
          "  });",
          "  let result;",
          "  if (mode === 'start') {",
          "    result = await manager.start({ projectId, projectRoot, revision });",
          "  } else {",
          "    await manager.recover(projectId);",
          "    result = await manager.get(projectId);",
          "  }",
          "  await fs.writeFile(resultPath, JSON.stringify(result), 'utf8');",
          "  await new Promise(() => {});",
          "})().catch((error) => { console.error(error); process.exitCode = 1; });",
        ].join("\n");
        const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
          cwd: apiServerRoot,
          env: {
            DATABASE_URL: childDatabaseUrl.toString(),
            PGAPPNAME: applicationName,
            NODE_ENV: "test",
            SESSION_SECRET: runtimeRecoveryTestSecret,
            ...supervisorFixture.clientEnvironment,
            WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH: supervisorSocketPath,
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? os.tmpdir(),
            AI_PROVIDER_EGRESS_DISABLED: "1",
            RUNTIME_TEST_MODE: mode,
            RUNTIME_TEST_PROJECT_ID: projectId,
            RUNTIME_TEST_PROJECT_ROOT: projectRoot,
            RUNTIME_TEST_REVISION: revision,
            RUNTIME_TEST_WORKER_ID: workerId,
            RUNTIME_TEST_RESULT_PATH: resultPath,
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdin.end();
        let workerOutput = "";
        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          workerOutput = `${workerOutput}${chunk}`.slice(-12_000);
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          workerOutput = `${workerOutput}${chunk}`.slice(-12_000);
        });
        child.once("exit", (code, signal) => {
          if (code !== null && code !== 0) {
            console.error(`Runtime recovery API worker exited (${code}); ${workerOutput}`);
          }
          if (signal && signal !== "SIGTERM" && signal !== "SIGKILL") {
            console.error(`Runtime recovery API worker exited by ${signal}; ${workerOutput}`);
          }
        });
        return child;
      };

      try {
        await waitForSupervisor(supervisor, supervisorFixture.socketPath);
        await fs.mkdir(projectRoot, { recursive: true });
        await fs.writeFile(
          path.join(projectRoot, "package.json"),
          JSON.stringify({ private: true, scripts: { dev: "node server.mjs" } }),
          "utf8",
        );
        await fs.writeFile(
          path.join(projectRoot, "server.mjs"),
          [
            "import http from 'node:http';",
            `const server = http.createServer((_request, response) => response.end(${JSON.stringify(revision)}));`,
            "server.listen(Number(process.env.PORT), '127.0.0.1');",
            "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
          ].join("\n"),
          "utf8",
        );
        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "runtime-start-response-loss-test",
          name: `Runtime response loss ${projectId.slice(0, 8)}`,
          rootPath: projectRoot,
          language: "javascript",
          status: "active",
        });

        proxy = createServer((request, response) => {
          if (request.method !== "POST" || request.url !== "/runtime/start") {
            response.writeHead(404);
            response.end();
            return;
          }
          startRequestCount += 1;
          void (async () => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const payload = Buffer.concat(chunks);
            const upstream = await new Promise<{ status: number; body: string }>((resolve, reject) => {
              const outgoing = requestOnSocket({
                  socketPath: supervisorFixture.socketPath,
                  path: "/runtime/start",
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "content-length": String(payload.byteLength),
                    "x-eos-command": request.headers["x-eos-command"] ?? "",
                    "x-eos-signature": request.headers["x-eos-signature"] ?? "",
                  },
                }, (upstreamResponse) => {
                  const responseChunks: Buffer[] = [];
                  upstreamResponse.on("data", (chunk) => responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                  upstreamResponse.once("error", reject);
                  upstreamResponse.once("end", () => resolve({
                    status: upstreamResponse.statusCode ?? 502,
                    body: Buffer.concat(responseChunks).toString("utf8"),
                  }));
                });
              outgoing.once("error", reject);
              outgoing.end(payload);
            });
            const result = JSON.parse(upstream.body) as typeof startReply;
            if (upstream.status < 200 || upstream.status >= 300 || !result) {
              throw new Error(`The real supervisor rejected startup with HTTP ${upstream.status}.`);
            }
            startReply = result;
            await fs.writeFile(supervisorResultPath, JSON.stringify(result), "utf8");
            await new Promise<void>((resolve) => {
              releaseHeldStartReply = resolve;
              response.once("close", resolve);
            });
            if (!response.destroyed) response.destroy();
          })().catch((error) => {
            if (!response.destroyed) {
              response.writeHead(502);
              response.end(error instanceof Error ? error.message : "proxy_failed");
            }
          });
        });
        await new Promise<void>((resolve, reject) => {
          proxy!.once("error", reject);
          proxy!.listen(proxySocketPath, resolve);
        });
        const startApplicationName = `runtime-start-loss-a-${projectId.slice(0, 8)}`;
        startApiWorker = spawnApiWorker(
          "start",
          startWorkerId,
          startApplicationName,
          proxySocketPath,
          path.join(testRoot, "start-worker-result.json"),
        );

        startReply = await waitForJsonFile<typeof startReply>(
          supervisorResultPath,
          60_000,
          "the real supervisor to finish creating the runtime before its reply is withheld",
        );
        expect(startReply).toMatchObject({
          projectId,
          status: "running",
          sessionId: expect.any(String),
          pid: expect.any(Number),
          port: expect.any(Number),
        });
        const startingRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(startingRow).toMatchObject({
          sessionId: startReply!.sessionId,
          status: "starting",
          workerId: startWorkerId,
          pid: null,
          port: null,
        });
        expect(await fetchRuntimeFixture(startReply!.port)).toBe(revision);
        expect(startRequestCount).toBe(1);

        startApiWorker.kill("SIGKILL");
        const startWorkerExit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => startApiWorker!.once("exit", (code, signal) => resolve({ code, signal })),
        );
        expect(startWorkerExit.signal).toBe("SIGKILL");
        releaseHeldStartReply?.();
        await waitForRuntimeWorkerDatabaseDisconnect(startApplicationName);
        expect(await fetchRuntimeFixture(startReply!.port)).toBe(revision);

        const supervisorAfterCrash = await supervisorClient.observeStartState(projectId);
        expect(supervisorAfterCrash).toMatchObject({
          status: "running",
          session: {
            projectId,
            sessionId: startReply!.sessionId,
            pid: startReply!.pid,
            port: startReply!.port,
          },
        });

        const orphanedRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(orphanedRow).toMatchObject({
          sessionId: startReply!.sessionId,
          status: "starting",
          workerId: startWorkerId,
          pid: null,
          port: null,
        });
        const orphanedLeaseUntil = orphanedRow?.leaseUntil?.getTime();
        expect(orphanedLeaseUntil).toBeGreaterThan(Date.now());
        if (!orphanedLeaseUntil) throw new Error("The interrupted API start left no durable lease.");
        while (Date.now() <= orphanedLeaseUntil) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const expiredRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(expiredRow?.workerId).toBe(startWorkerId);
        expect(expiredRow?.leaseUntil?.getTime()).toBeLessThan(Date.now());

        const recoveryApplicationName = `runtime-start-loss-b-${projectId.slice(0, 8)}`;
        const recoverySocketPath = supervisorFixture.socketPath;
        recoveryApiWorker = spawnApiWorker(
          "recover",
          recoveryWorkerId,
          recoveryApplicationName,
          recoverySocketPath,
          recoveryResultPath,
        );
        const recovered = await waitForJsonFile<{
          projectId: string;
          sessionId: string;
          status: string;
          pid: number;
          port: number;
          workerId: string;
        }>(
          recoveryResultPath,
          45_000,
          "the replacement API worker to recover the durable start",
        );
        if (recovered.status !== "running") {
          const row = await databaseWorkspaceRuntimeStore.get(projectId);
          const listener = await resolveRuntimeListenerProcess({
            launchPid: startReply!.pid,
            port: startReply!.port,
            bindingDigest: "0".repeat(64),
          });
          const owner = row?.workerId === recoveryWorkerId
            ? "recovery-worker"
            : row?.workerId
              ? "other-worker"
              : "unclaimed";
          const lease = row?.leaseUntil && row.leaseUntil.getTime() > Date.now()
            ? "active"
            : "expired";
          throw new Error([
            "Runtime recovery did not establish running state.",
            `snapshot=${recovered.status}`,
            `row=${row?.status ?? "missing"}`,
            `owner=${owner}`,
            `lease=${lease}`,
            `listener=${listener.status}/${listener.reasonCode}`,
          ].join(" "));
        }
        expect(recovered).toMatchObject({
          projectId,
          sessionId: startReply!.sessionId,
          status: "running",
          pid: startReply!.pid,
          port: startReply!.port,
        });
        expect(startRequestCount).toBe(1);
        expect(process.kill(-startReply!.pid, 0)).toBe(true);
        expect(await fetchRuntimeFixture(startReply!.port)).toBe(revision);
        const ownedRow = await databaseWorkspaceRuntimeStore.get(projectId);
        expect(ownedRow).toMatchObject({
          sessionId: startReply!.sessionId,
          status: "running",
          workerId: recoveryWorkerId,
          pid: startReply!.pid,
          port: startReply!.port,
        });
        expect(ownedRow?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(await supervisorClient.observeStartState(projectId)).toMatchObject({
          status: "running",
          session: {
            projectId,
            sessionId: startReply!.sessionId,
            pid: startReply!.pid,
            port: startReply!.port,
          },
        });

        await stopProcess(recoveryApiWorker);
        await waitForRuntimeWorkerDatabaseDisconnect(recoveryApplicationName);
        recoveryApiWorker = undefined;
      } finally {
        if (startApiWorker && startApiWorker.exitCode === null && startApiWorker.signalCode === null) {
          await stopProcess(startApiWorker, "SIGKILL");
        }
        if (recoveryApiWorker && recoveryApiWorker.exitCode === null && recoveryApiWorker.signalCode === null) {
          await stopProcess(recoveryApiWorker, "SIGTERM");
        }
        releaseHeldStartReply?.();
        if (proxy?.listening) {
          await new Promise<void>((resolve) => proxy!.close(() => resolve()));
        }
        const persisted = await databaseWorkspaceRuntimeStore.get(projectId).catch(() => undefined);
        if (persisted?.sessionId && persisted.startedAt) {
          await supervisorClient.stop({
            projectId,
            sessionId: persisted.sessionId,
            stateVersion: createWorkspaceRuntimeSupervisorStateVersion({
              projectId,
              sessionId: persisted.sessionId,
              revision: persisted.revision,
              startedAt: persisted.startedAt.toISOString(),
            }),
            pid: persisted.pid,
          }).catch(() => undefined);
        }
        await supervisorFixture.stop();
      }
    },
    180_000,
  );
});

describe("workspace runtime full API startup recovery", () => {
  it.skipIf(process.env.RUN_RUNTIME_STARTUP_RECOVERY !== "1")(
    "adopts the exact live session at src/index.ts startup and leaves unknown ownership retryable",
    async () => {
      const databaseUrl = requireDisposableRuntimeDatabaseUrl();
      const knownProjectId = randomUUID();
      const unknownProjectId = randomUUID();
      const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-api-startup-recovery-"));
      const knownRoot = path.join(testRoot, "known-runtime");
      const unknownRoot = path.join(testRoot, "unknown-runtime");
      const runtimePortFile = path.join(testRoot, "runtime-port.txt");
      const preloadFile = path.join(testRoot, "runtime-fetch-fixture.mjs");
      const blockedEgressFile = path.join(testRoot, "blocked-egress.txt");
      projectIds.push(knownProjectId, unknownProjectId);
      roots.push(testRoot);

      let supervisorFixture: Awaited<ReturnType<typeof startWorkspaceRuntimeSupervisorTestFixture>> | undefined;
      let runtimeLauncher: ChildProcess | undefined;
      let unknownOwner: ChildProcess | undefined;
      let runtimePid: number | undefined;
      let runtimePort: number | undefined;
      let apiBefore: {
        child: ChildProcessWithoutNullStreams;
        applicationName: string;
        exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
        output: () => string;
      } | undefined;
      let apiAfter: typeof apiBefore;
      const supervisorRequests: Array<{
        projectId: string;
        sessionId: string;
        projectRoot: string;
        pid: number | null;
        port: number | null;
        listenerBindingDigest: string;
        expectedListenerIdentityDigest: string;
      }> = [];
      const unexpectedSupervisorPaths: string[] = [];

      const spawnApiWorker = (
        port: number,
        applicationName: string,
        supervisorFixturePort: number,
      ) => {
        const childDatabaseUrl = new URL(databaseUrl.toString());
        childDatabaseUrl.searchParams.set("application_name", applicationName);
        let stdout = "";
        let stderr = "";
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--import", preloadFile, "src/index.ts"],
          {
            cwd: process.cwd(),
            env: {
              DATABASE_URL: childDatabaseUrl.toString(),
              PGAPPNAME: applicationName,
              NODE_ENV: "test",
              SESSION_SECRET: runtimeRecoveryTestSecret,
              ...supervisorFixture!.clientEnvironment,
              LOG_LEVEL: "warn",
              APP_ORIGINS: "",
              PORT: String(port),
              PATH: process.env.PATH ?? "",
              HOME: process.env.HOME ?? os.tmpdir(),
              AI_PROVIDER_EGRESS_DISABLED: "1",
              AI_CREDENTIALS_ENCRYPTION_KEY:
                `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
              RUNTIME_TEST_BLOCKED_EGRESS_FILE: blockedEgressFile,
            },
            stdio: "pipe",
          },
        );
        child.stdin.end();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout = `${stdout}${chunk}`.slice(-16_000);
        });
        child.stderr.on("data", (chunk: string) => {
          stderr = `${stderr}${chunk}`.slice(-16_000);
        });
        const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
          child.once("exit", (code, signal) => resolve({ code, signal }));
        });
        return {
          child,
          applicationName,
          exit,
          output: () => `stdout=${stdout}; stderr=${stderr}`,
        };
      };

      const stopApiWorker = async (worker: NonNullable<typeof apiBefore>): Promise<void> => {
        if (worker.child.exitCode === null && worker.child.signalCode === null) {
          worker.child.kill("SIGTERM");
          const gracefulExit = await Promise.race([
            worker.exit.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 20_000)),
          ]);
          if (!gracefulExit) {
            worker.child.kill("SIGKILL");
            await worker.exit;
          }
        }
        await waitForRuntimeWorkerDatabaseDisconnect(worker.applicationName);
      };

      try {
        await fs.mkdir(knownRoot, { recursive: true });
        await fs.mkdir(unknownRoot, { recursive: true });
        await fs.writeFile(
          path.join(knownRoot, "package.json"),
          JSON.stringify({ scripts: { dev: "node server.mjs" } }),
        );
        await fs.writeFile(
          path.join(knownRoot, "server.mjs"),
          [
            "import { promises as fs } from 'node:fs';",
            "import http from 'node:http';",
            "const server = http.createServer((_req, res) => res.end('runtime-startup-live'));",
            "server.listen(Number(process.env.PORT), '127.0.0.1', async () => {",
            "  const address = server.address();",
            "  await fs.writeFile(process.env.RUNTIME_READY_FILE, String(address.port));",
            "});",
            "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
          ].join("\n"),
        );
        await fs.writeFile(
          preloadFile,
          [
            "import { appendFileSync } from 'node:fs';",
            "const fixtureUrl = process.env.RUNTIME_TEST_SUPERVISOR_FIXTURE_URL;",
            "if (!fixtureUrl) throw new Error('Local runtime supervisor fixture URL is missing.');",
            "const nativeFetch = globalThis.fetch.bind(globalThis);",
            "globalThis.fetch = (input, init) => {",
            "  const rawUrl = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;",
            "  const target = new URL(rawUrl);",
            "  if (target.origin === 'http://127.0.0.1:8099') {",
            "    return nativeFetch(new URL(`${target.pathname}${target.search}`, fixtureUrl), init);",
            "  }",
            "  if (['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {",
            "    return nativeFetch(input, init);",
            "  }",
            "  const blockedFile = process.env.RUNTIME_TEST_BLOCKED_EGRESS_FILE;",
            "  if (blockedFile) appendFileSync(blockedFile, `${target.origin}\\n`, 'utf8');",
            "  return Promise.reject(new Error(`External fetch blocked in runtime startup fixture: ${target.origin}`));",
            "};",
          ].join("\n"),
        );

        supervisorServer = createServer((request, response) => {
          void (async () => {
            if (request.method === "GET" && request.url === "/healthz") {
              response.writeHead(200, { "content-type": "application/json" });
              response.end(JSON.stringify({ status: "ok" }));
              return;
            }
            if (request.method !== "POST" || request.url !== "/runtime/adopt") {
              unexpectedSupervisorPaths.push(`${request.method ?? "unknown"} ${request.url ?? ""}`);
              response.writeHead(404, { "content-type": "application/json" });
              response.end(JSON.stringify({ error: "not_found" }));
              return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              projectId: string;
              sessionId: string;
              projectRoot: string;
              pid: number | null;
              port: number | null;
              listenerBindingDigest: string;
              expectedListenerIdentityDigest: string;
            };
            supervisorRequests.push({
              projectId: input.projectId,
              sessionId: input.sessionId,
              projectRoot: input.projectRoot,
              pid: input.pid,
              port: input.port,
              listenerBindingDigest: input.listenerBindingDigest,
              expectedListenerIdentityDigest: input.expectedListenerIdentityDigest,
            });
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({
              ...input,
              status: "running",
              listenerIdentityDigest: input.expectedListenerIdentityDigest,
              logs: ["adopted by isolated local supervisor fixture"],
            }));
          })().catch((error) => {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({
              error: error instanceof Error ? error.message : "fixture_failed",
            }));
          });
        });
        const localSupervisorPort = await listenLoopback(supervisorServer);
        supervisorFixture = await startWorkspaceRuntimeSupervisorTestFixture({
          allowedRoots: [knownRoot, unknownRoot],
        });
        await waitForSupervisor(supervisorFixture.child, supervisorFixture.socketPath);
        const supervisorClient = new WorkspaceRuntimeSupervisorClient(
          supervisorFixture.socketPath,
          supervisorFixture.signingPrivateKeyBase64,
        );

        await db.insert(projectsTable).values([
          {
            id: knownProjectId,
            ownerId: "runtime-api-startup-recovery-owner",
            name: `Known runtime ${knownProjectId.slice(0, 8)}`,
            rootPath: knownRoot,
            language: "typescript",
            status: "active",
          },
          {
            id: unknownProjectId,
            ownerId: "runtime-api-startup-recovery-owner",
            name: `Unknown runtime ${unknownProjectId.slice(0, 8)}`,
            rootPath: unknownRoot,
            language: "typescript",
            status: "active",
          },
        ]);

        runtimeLauncher = spawn("pnpm", ["run", "dev"], {
          cwd: knownRoot,
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? os.tmpdir(),
            NODE_ENV: "test",
            PORT: "0",
            RUNTIME_READY_FILE: runtimePortFile,
          },
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        });
        const knownRuntimePid = runtimeLauncher.pid;
        if (!knownRuntimePid) throw new Error("The detached runtime launcher did not start.");
        runtimePid = knownRuntimePid;
        const knownRuntimePort = await waitForRuntimePortFile(runtimePortFile, runtimeLauncher);
        runtimePort = knownRuntimePort;
        expect(await fetchRuntimeFixture(knownRuntimePort)).toBe("runtime-startup-live");

        unknownOwner = spawn(
          process.execPath,
          ["-e", "process.once('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"],
          {
            detached: true,
            stdio: ["ignore", "ignore", "ignore"],
            env: {
              PATH: process.env.PATH ?? "",
              HOME: process.env.HOME ?? os.tmpdir(),
            },
          },
        );
        const unknownOwnerPid = unknownOwner.pid;
        if (!unknownOwnerPid) throw new Error("The unrelated listener-owner fixture did not start.");
        await new Promise((resolve) => setTimeout(resolve, 100));

        const seedWorkerId = `runtime-api-startup-orphan-${randomUUID()}`;
        const sessionId = `session-${randomUUID()}`;
        const revision = "runtime-api-startup-recovery-revision";
        const staleAt = new Date(Date.now() - RUNTIME_LEASE_MS * 2);
        const expiredLease = new Date(Date.now() - 1);
        const knownBegin = await databaseWorkspaceRuntimeStore.begin({
          projectId: knownProjectId,
          projectRoot: knownRoot,
          sessionId,
          revision,
          environmentRevision: null,
          workerId: seedWorkerId,
          now: staleAt,
          leaseUntil: expiredLease,
        });
        if (!knownBegin) throw new Error("The known runtime row was not persisted.");
        expect(await databaseWorkspaceRuntimeStore.updateOwnedSession(
          knownProjectId,
          sessionId,
          seedWorkerId,
          {
            status: "running",
            pid: knownRuntimePid,
            port: knownRuntimePort,
            lastHeartbeatAt: staleAt,
            leaseUntil: expiredLease,
          },
        )).toBe(true);

        const unknownSessionId = `session-${randomUUID()}`;
        const unknownBegin = await databaseWorkspaceRuntimeStore.begin({
          projectId: unknownProjectId,
          projectRoot: unknownRoot,
          sessionId: unknownSessionId,
          revision,
          environmentRevision: null,
          workerId: seedWorkerId,
          now: staleAt,
          leaseUntil: expiredLease,
        });
        if (!unknownBegin) throw new Error("The unknown runtime row was not persisted.");
        expect(await databaseWorkspaceRuntimeStore.updateOwnedSession(
          unknownProjectId,
          unknownSessionId,
          seedWorkerId,
          {
            status: "running",
            pid: unknownOwnerPid,
            port: localSupervisorPort,
            lastHeartbeatAt: staleAt,
            leaseUntil: expiredLease,
          },
        )).toBe(true);

        const beforePort = await reserveLoopbackPort();
        const beforeApplicationName = `runtime-api-before-${randomUUID().slice(0, 8)}`;
        const initialApi = spawnApiWorker(beforePort, beforeApplicationName, localSupervisorPort);
        apiBefore = initialApi;
        await waitForApiWorkerReady(beforePort, initialApi.child, initialApi.output);

        const knownBeforeCrash = await databaseWorkspaceRuntimeStore.get(knownProjectId);
        expect(knownBeforeCrash).toMatchObject({
          status: "running",
          sessionId,
          projectRoot: knownRoot,
          pid: knownRuntimePid,
          port: knownRuntimePort,
        });
        const priorOwnerId = knownBeforeCrash?.workerId;
        expect(priorOwnerId).toBeTruthy();
        if (!priorOwnerId) throw new Error("The first API process did not claim the known runtime lease.");
        expect(priorOwnerId).not.toBe(seedWorkerId);
        expect(knownBeforeCrash?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(supervisorRequests).toHaveLength(0);
        expect(await supervisorClient.observeStartState(knownProjectId)).toMatchObject({
          status: "running",
          session: { projectId: knownProjectId, sessionId, pid: knownRuntimePid, port: knownRuntimePort },
        });

        const unknownBeforeCrash = await databaseWorkspaceRuntimeStore.get(unknownProjectId);
        expect(unknownBeforeCrash).toMatchObject({
          status: "running",
          sessionId: unknownSessionId,
          pid: unknownOwnerPid,
          port: localSupervisorPort,
          workerId: null,
          leaseUntil: null,
        });
        expect(process.kill(unknownOwnerPid, 0)).toBe(true);

        initialApi.child.kill("SIGKILL");
        expect((await initialApi.exit).signal).toBe("SIGKILL");
        await waitForRuntimeWorkerDatabaseDisconnect(beforeApplicationName);
        expect(await fetchRuntimeFixture(knownRuntimePort)).toBe("runtime-startup-live");

        const orphanedRuntime = await databaseWorkspaceRuntimeStore.get(knownProjectId);
        expect(orphanedRuntime).toMatchObject({
          status: "running",
          sessionId,
          workerId: priorOwnerId,
          pid: knownRuntimePid,
          port: knownRuntimePort,
        });
        const orphanedLeaseUntil = orphanedRuntime?.leaseUntil?.getTime();
        expect(orphanedLeaseUntil).toBeGreaterThan(Date.now());
        if (!orphanedLeaseUntil) throw new Error("The killed API worker left no durable runtime lease to expire.");
        while (Date.now() <= orphanedLeaseUntil) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const naturallyExpiredRuntime = await databaseWorkspaceRuntimeStore.get(knownProjectId);
        expect(naturallyExpiredRuntime?.workerId).toBe(priorOwnerId);
        expect(naturallyExpiredRuntime?.leaseUntil?.getTime()).toBeLessThan(Date.now());

        const afterPort = await reserveLoopbackPort();
        const afterApplicationName = `runtime-api-after-${randomUUID().slice(0, 8)}`;
        const replacementApi = spawnApiWorker(afterPort, afterApplicationName, localSupervisorPort);
        apiAfter = replacementApi;
        await waitForApiWorkerReady(afterPort, replacementApi.child, replacementApi.output);

        const knownRecovered = await databaseWorkspaceRuntimeStore.get(knownProjectId);
        expect(knownRecovered).toMatchObject({
          status: "running",
          sessionId,
          projectRoot: knownRoot,
          pid: knownRuntimePid,
          port: knownRuntimePort,
        });
        expect(knownRecovered?.workerId).toBeTruthy();
        expect(knownRecovered?.workerId).not.toBe(priorOwnerId);
        expect(knownRecovered?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());
        expect(await fetchRuntimeFixture(knownRuntimePort)).toBe("runtime-startup-live");

        const unknownRecovered = await databaseWorkspaceRuntimeStore.get(unknownProjectId);
        expect(unknownRecovered).toMatchObject({
          status: "running",
          sessionId: unknownSessionId,
          pid: unknownOwnerPid,
          port: localSupervisorPort,
          workerId: null,
          leaseUntil: null,
        });
        expect(process.kill(unknownOwnerPid, 0)).toBe(true);
        expect(supervisorRequests).toHaveLength(0);
        expect(await supervisorClient.observeStartState(knownProjectId)).toMatchObject({
          status: "running",
          session: { projectId: knownProjectId, sessionId, pid: knownRuntimePid, port: knownRuntimePort },
        });
        await expect(fs.access(blockedEgressFile)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        if (apiAfter) await stopApiWorker(apiAfter);
        if (apiBefore) await stopApiWorker(apiBefore);
        if (runtimePid) await stopDetachedRuntimeProcessGroup(runtimePid, runtimePort);
        if (unknownOwner?.pid) await stopDetachedRuntimeProcessGroup(unknownOwner.pid);
        if (supervisorServer?.listening) {
          await new Promise<void>((resolve) => supervisorServer!.close(() => resolve()));
        }
        await supervisorFixture?.stop();
      }
    },
    240_000,
  );
});

describe("in-memory workspace runtime store session fencing", () => {
  it("rejects recovery claims and lease writes for a replaced session", async () => {
    const store = createInMemoryWorkspaceRuntimeStore();
    const now = new Date();
    await store.begin({
      projectId: "fenced-runtime-project",
      projectRoot: "/workspace/project",
      sessionId: "session-old",
      revision: "revision-old",
      environmentRevision: null,
      attestationBinding: null,
      attestationKeyVersion: null,
      workerId: "worker-a",
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    const replacementAt = new Date(now.getTime() + RUNTIME_LEASE_MS + 2);
    const replacement = await store.begin({
      projectId: "fenced-runtime-project",
      projectRoot: "/workspace/project",
      sessionId: "session-new",
      revision: "revision-new",
      environmentRevision: null,
      attestationBinding: null,
      attestationKeyVersion: null,
      workerId: "worker-a",
      now: replacementAt,
      leaseUntil: new Date(replacementAt.getTime() + RUNTIME_LEASE_MS),
    });
    expect(replacement?.sessionId).toBe("session-new");

    expect(await store.claimRecovery({
      id: "fenced-runtime-project",
      sessionId: "session-old",
      workerId: "worker-b",
      now: new Date(now.getTime() + RUNTIME_LEASE_MS + 2),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS * 2),
    })).toBeUndefined();
    expect(await store.updateOwnedSession(
      "fenced-runtime-project",
      "session-old",
      "worker-a",
      { leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS * 3) },
    )).toBe(false);
    expect(await store.updateOwnedSession(
      "fenced-runtime-project",
      "session-new",
      "worker-a",
      { leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS * 3) },
      "running",
    )).toBe(false);
    expect((await store.get("fenced-runtime-project"))?.sessionId).toBe("session-new");
  });
});