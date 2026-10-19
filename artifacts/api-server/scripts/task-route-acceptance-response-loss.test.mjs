import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const apiServerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testEnabled = process.env.RUN_TASK_ROUTE_ACCEPTANCE_CRASH === "1";

function requireDisposableDatabaseUrl() {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Task-route response-loss validation requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(databaseUrl.hostname)) {
    throw new Error("Task-route response-loss validation is restricted to loopback PostgreSQL.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (!/(?:^|[_-])(?:test|disposable)(?:[_-]|$)/iu.test(databaseName)) {
    throw new Error("Task-route response-loss validation requires a disposable or test-named database.");
  }
  return databaseUrl;
}

function startApiProcess(options) {
  const databaseUrl = requireDisposableDatabaseUrl();
  const applicationName = options.applicationName;
  databaseUrl.searchParams.set("application_name", applicationName);

  const source = [
    "(async () => {",
    '  const { createServer } = await import("node:net");',
    "  const reservation = createServer();",
    '  await new Promise((resolve, reject) => reservation.listen(0, "127.0.0.1", resolve));',
    "  const address = reservation.address();",
    '  if (!address || typeof address === "string") throw new Error("Could not reserve an API port.");',
    '  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));',
    "  process.env.PORT = String(address.port);",
    '  process.stdout.write("API_INDEX_IMPORT_BEGIN\\n");',
    "  if (process.env.TASK_ROUTE_RESPONSE_TASK_ID) {",
    '    const { Server } = await import("node:http");',
    '    const { writeFileSync } = await import("node:fs");',
    "    const targetTaskId = process.env.TASK_ROUTE_RESPONSE_TASK_ID;",
    '    const targetPath = "/api/ai/tasks/" + targetTaskId + "/execute";',
    "    const signalFile = process.env.TASK_ROUTE_RESPONSE_SIGNAL_FILE;",
    '    if (!signalFile) throw new Error("Task route response blocker is missing its signal file.");',
    "    const originalEmit = Server.prototype.emit;",
    "    Server.prototype.emit = function (event, ...args) {",
    '      if (event === "request") {',
    "        const [req, res] = args;",
    "        const requestPath = req?.url;",
    '        if (req?.method === "POST" && requestPath === targetPath) {',
    "          let responseBlocked = false;",
    "          res.end = function () {",
    "            if (!responseBlocked) {",
    "              responseBlocked = true;",
    "              writeFileSync(signalFile, JSON.stringify({",
    '                stage: "http_response_blocked_before_socket_write",',
    "                method: req.method,",
    "                path: requestPath,",
    "                statusCode: res.statusCode,",
    '              }), "utf8");',
    "            }",
    "            return this;",
    "          };",
    "        }",
    "      }",
    "      return originalEmit.call(this, event, ...args);",
    "    };",
    "  }",
    '  await import("./dist/index.mjs");',
    '  if (process.env.TASK_ROUTE_PROVIDER_FIXTURE === "1") {',
    '    process.env.OPENROUTER_API_KEY = "test-dummy-openrouter-key-for-response-loss";',
    '    process.env.AI_PROVIDER_EGRESS_DISABLED = "0";',
    "  }",
    '  process.stdout.write("API_INDEX_READY:" + address.port + "\\n");',
    "  await new Promise(() => {});",
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");

  const childArgs = [];
  if (options.providerFixture) {
    childArgs.push("--import", "./src/lib/task-route-provider-fixture.mjs");
  }
  childArgs.push("-e", source);

  const childEnv = {
    DATABASE_URL: databaseUrl.toString(),
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    WORKSPACE_PATH: options.workspacePath ?? process.env.WORKSPACE_PATH ?? apiServerRoot,
    RUN_CONTROLLED_RELEASE_VALIDATION: "1",
    DASHBOARD_E2E_TEST_MODE: "fixture",
    PGAPPNAME: applicationName,
    ...(options.providerFixture
      ? {
          AI_PROVIDER_EGRESS_DISABLED: "1",
          GROQ_CATALOG_FIXTURE_MODE: "healthy",
          TASK_ROUTE_PROVIDER_FIXTURE: "1",
          TASK_ROUTE_PROVIDER_FIXTURE_LOG: options.providerFixtureLogFile,
        }
      : { AI_PROVIDER_EGRESS_DISABLED: "1" }),
    ...(options.blockTaskResponse
      ? {
          TASK_ROUTE_RESPONSE_TASK_ID: options.blockTaskResponse.taskId,
          TASK_ROUTE_RESPONSE_SIGNAL_FILE: options.blockTaskResponse.signalFile,
        }
      : {}),
  };
  const child = spawn(process.execPath, childArgs, {
    cwd: apiServerRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const output = () => {
    let raw = `stdout=${stdout}; stderr=${stderr}`;
    raw = raw.split(databaseUrl.toString()).join("[DATABASE_URL]");
    if (databaseUrl.password) {
      raw = raw.split(decodeURIComponent(databaseUrl.password)).join("[REDACTED]");
    }
    return raw;
  };
  const getBaseUrl = () => {
    const readyMatch = stdout.match(/API_INDEX_READY:(\d+)/u);
    if (!readyMatch) throw new Error(`API process has not reported its port; ${output()}`);
    return `http://127.0.0.1:${readyMatch[1]}`;
  };
  const waitForReady = async (timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`API process exited before readiness; ${output()}`);
      }
      if (/API_INDEX_READY:\d+/u.test(stdout)) {
        await waitForPort(Number(getBaseUrl().split(":").at(-1)), child, 5_000, output);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for API process readiness; ${output()}`);
  };

  return { applicationName, child, exit, output, getBaseUrl, waitForReady };
}

async function waitForPort(port, child, timeoutMs, output) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`API process exited before its port opened; ${output()}`);
    }
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`API process port did not open; ${output()}`);
}

async function waitForSignalFile(filePath, processHandle, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
      throw new Error(`API process exited before the response boundary signal; ${processHandle.output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the HTTP response boundary; ${processHandle.output()}`);
}

async function waitForChildExit(processHandle, timeoutMs = 30_000) {
  return Promise.race([
    processHandle.exit,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for API process exit; ${processHandle.output()}`)), timeoutMs)
        .unref();
    }),
  ]);
}

async function waitForDatabaseDisconnect(db, sql, applicationName, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT pid
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND pid <> pg_backend_pid()
    `);
    const rows = result.rows ?? [];
    if (rows.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API process database session did not disconnect: ${applicationName}`);
}

async function stopApiProcess(processHandle, db, sql) {
  if (!processHandle) return;
  if (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
    processHandle.child.kill("SIGKILL");
  }
  await waitForChildExit(processHandle);
  await waitForDatabaseDisconnect(db, sql, processHandle.applicationName);
}

async function readAcceptedState(db, tables, eq, and, projectId, taskId) {
  const executions = await db
    .select({
      id: tables.aiExecutionsTable.id,
      projectId: tables.aiExecutionsTable.projectId,
      userId: tables.aiExecutionsTable.userId,
      linkedTaskId: tables.aiExecutionsTable.linkedTaskId,
      attempt: tables.aiExecutionsTable.attempt,
      status: tables.aiExecutionsTable.status,
    })
    .from(tables.aiExecutionsTable)
    .where(eq(tables.aiExecutionsTable.linkedTaskId, taskId));
  const acceptances = await db
    .select({
      executionId: tables.aiExecutionAcceptancesTable.executionId,
      attempt: tables.aiExecutionAcceptancesTable.attempt,
      outcome: tables.aiExecutionAcceptancesTable.outcome,
      terminalStatus: tables.aiExecutionAcceptancesTable.terminalStatus,
    })
    .from(tables.aiExecutionAcceptancesTable)
    .where(eq(tables.aiExecutionAcceptancesTable.projectId, projectId));
  const [task] = await db
    .select({
      status: tables.tasksTable.status,
    })
    .from(tables.tasksTable)
    .where(eq(tables.tasksTable.id, taskId))
    .limit(1);
  const completionEvents = await db
    .select({ type: tables.eventsTable.type })
    .from(tables.eventsTable)
    .where(and(
      eq(tables.eventsTable.taskId, taskId),
      eq(tables.eventsTable.type, "TaskCompleted"),
    ));
  return { executions, acceptances, task, completionEvents };
}

async function cleanupProjectExecutionData(db, tables, eq, and, projectId) {
  await db.delete(tables.aiUsageEventsTable).where(eq(tables.aiUsageEventsTable.projectId, projectId));
  await db.delete(tables.operatorAlertsTable).where(and(
    eq(tables.operatorAlertsTable.ownerId, "test-user"),
    eq(tables.operatorAlertsTable.projectId, projectId),
  ));
  await db.delete(tables.aiAgentEpisodeEventsTable).where(eq(tables.aiAgentEpisodeEventsTable.projectId, projectId));
  await db.delete(tables.aiAgentObservationsTable).where(eq(tables.aiAgentObservationsTable.projectId, projectId));
  await db.delete(tables.aiAgentEffectsTable).where(eq(tables.aiAgentEffectsTable.projectId, projectId));
  await db.delete(tables.aiExecutionAcceptancesTable).where(
    eq(tables.aiExecutionAcceptancesTable.projectId, projectId),
  );
  await db.delete(tables.aiAgentEffectBundlesTable).where(eq(tables.aiAgentEffectBundlesTable.projectId, projectId));
  await db.delete(tables.aiAgentEpisodesTable).where(eq(tables.aiAgentEpisodesTable.projectId, projectId));
  await db.delete(tables.aiExecutionsTable).where(eq(tables.aiExecutionsTable.projectId, projectId));
}

test(
  "preserves an accepted HTTP AI task when the process crashes before its response",
  { skip: !testEnabled, timeout: 180_000 },
  async () => {
    const databaseUrl = requireDisposableDatabaseUrl();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("PG")) delete process.env[key];
    }
    databaseUrl.searchParams.set("application_name", `task-route-acceptance-parent-${randomUUID()}`);
    process.env.DATABASE_URL = databaseUrl.toString();
    let databaseModule;
    let drizzleModule;
    const projectId = randomUUID();
    const taskId = randomUUID();
    const now = new Date();
    let signalRoot;
    let workerProcess;
    let recoveryProcess;
    let responseRequest;

    try {
      [databaseModule, drizzleModule] = await Promise.all([
        import("@workspace/db"),
        import("drizzle-orm"),
      ]);
      const { db, ...tables } = databaseModule;
      const { and, eq, sql } = drizzleModule;
      signalRoot = await mkdtemp(path.join("/tmp", "ai-task-route-accepted-crash-"));
      const workspacePath = path.join(signalRoot, "workspace");
      await mkdir(workspacePath, { recursive: true });

      await db.insert(tables.projectsTable).values({
        id: projectId,
        ownerId: "test-user",
        name: `task-route-accepted-crash-${projectId.slice(0, 8)}`,
        rootPath: workspacePath,
        language: "typescript",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(tables.tasksTable).values({
        id: taskId,
        projectId,
        title: `Accepted AI task ${taskId.slice(0, 6)}`,
        description: "A task for the post-acceptance HTTP crash fixture.",
        status: "pending",
        priority: "p2",
        createdAt: now,
        updatedAt: now,
      });

      const responseSignalFile = path.join(signalRoot, "http-response-blocked.json");
      const providerFixtureLogFile = path.join(signalRoot, "provider-requests.jsonl");
      workerProcess = startApiProcess({
        applicationName: `ai-task-accepted-response-worker-${randomUUID()}`,
        workspacePath,
        blockTaskResponse: { taskId, signalFile: responseSignalFile },
        providerFixture: true,
        providerFixtureLogFile,
      });
      await workerProcess.waitForReady();
      const workerBaseUrl = workerProcess.getBaseUrl();
      responseRequest = fetch(`${workerBaseUrl}/api/ai/tasks/${taskId}/execute`, {
        method: "POST",
        headers: {
          origin: workerBaseUrl,
          "content-type": "application/json",
        },
        body: "{}",
      }).then(
        (response) => ({ kind: "response", status: response.status }),
        (error) => ({
          kind: "disconnected",
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      const responseBoundary = await waitForSignalFile(responseSignalFile, workerProcess);
      assert.deepEqual(responseBoundary, {
        stage: "http_response_blocked_before_socket_write",
        method: "POST",
        path: `/api/ai/tasks/${taskId}/execute`,
        statusCode: 202,
      });

      const acceptedState = await readAcceptedState(db, tables, eq, and, projectId, taskId);
      assert.equal(acceptedState.executions.length, 1, "the route must create exactly one execution");
      const acceptedExecution = acceptedState.executions[0];
      assert.deepEqual(acceptedExecution, {
        id: acceptedExecution.id,
        projectId,
        userId: "test-user",
        linkedTaskId: taskId,
        attempt: 0,
        status: "completed",
      });
      assert.deepEqual(acceptedState.acceptances, [{
        executionId: acceptedExecution.id,
        attempt: 0,
        outcome: "SUCCEEDED",
        terminalStatus: "completed",
      }]);
      assert.deepEqual(acceptedState.task, { status: "completed" });
      assert.equal(acceptedState.completionEvents.length, 1, "completion must be recorded exactly once");

      const providerRequests = (await readFile(providerFixtureLogFile, "utf8"))
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.ok(providerRequests.some((entry) => entry.kind === "chat-completion"));
      assert.ok(providerRequests.some((entry) => entry.kind === "model-catalog"));
      assert.ok(providerRequests.every((entry) => entry.host === "openrouter.ai"));

      assert.equal(workerProcess.child.kill("SIGKILL"), true);
      assert.deepEqual(await waitForChildExit(workerProcess), { code: null, signal: "SIGKILL" });
      await waitForDatabaseDisconnect(db, sql, workerProcess.applicationName);
      workerProcess = undefined;
      const lostResponse = await responseRequest;
      assert.equal(lostResponse.kind, "disconnected");
      assert.ok(lostResponse.error);

      recoveryProcess = startApiProcess({
        applicationName: `ai-task-accepted-recovery-${randomUUID()}`,
        workspacePath,
        providerFixture: false,
      });
      await recoveryProcess.waitForReady();
      const recoveredState = await readAcceptedState(db, tables, eq, and, projectId, taskId);
      assert.deepEqual(recoveredState, acceptedState);

      const recoveredResponse = await fetch(`${recoveryProcess.getBaseUrl()}/api/tasks/${taskId}`);
      assert.equal(recoveredResponse.status, 200);
      const recoveredBody = await recoveredResponse.json();
      assert.equal(recoveredBody.id, taskId);
      assert.equal(recoveredBody.status, "completed");
      assert.equal(recoveredBody.acceptance?.attempt, 0);
      assert.equal(recoveredBody.acceptance?.outcome, "SUCCEEDED");
      assert.equal(recoveredBody.acceptance?.terminalStatus, "completed");
    } finally {
      if (databaseModule && drizzleModule) {
        const { db, pool, ...tables } = databaseModule;
        const { and, eq, sql } = drizzleModule;
        try {
          await stopApiProcess(workerProcess, db, sql);
          await stopApiProcess(recoveryProcess, db, sql);
        } finally {
          await cleanupProjectExecutionData(db, tables, eq, and, projectId);
          await db.delete(tables.taskLogsTable).where(eq(tables.taskLogsTable.taskId, taskId));
          await db.delete(tables.eventsTable).where(eq(tables.eventsTable.taskId, taskId));
          await db.delete(tables.tasksTable).where(eq(tables.tasksTable.id, taskId));
          await db.delete(tables.projectsTable).where(eq(tables.projectsTable.id, projectId));
          if (signalRoot) await rm(signalRoot, { recursive: true, force: true });
          await pool.end();
        }
      } else if (signalRoot) {
        await rm(signalRoot, { recursive: true, force: true });
      }
    }
  },
);
