import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUnresolvedRuntimeStartAlert,
  UNRESOLVED_RUNTIME_START_ALERT_MS,
  WorkspaceRuntimeManager,
} from "./workspace-runtime.js";
import {
  createInMemoryWorkspaceRuntimeStore,
  type WorkspaceRuntimeStore,
} from "./workspace-runtime-store.js";
import type { WorkspaceRuntimeSupervisorClient } from "./workspace-runtime-supervisor-client.js";

type SupervisorSession = {
  projectId: string;
  sessionId: string;
  status: "starting" | "running" | "stopped" | "failed";
  port: number | null;
  pid: number | null;
  logs?: string[];
  error?: string | null;
};

type SupervisorObservation = {
  projectId: string;
  ownerProjectId: string;
  status: "running" | "stopped" | "unknown";
  session?: SupervisorSession;
  observedAt: string;
  inventoryComplete: boolean;
  unknownListenerPorts: number[];
  detail: string;
};

type SupervisorStartInput = {
  projectId: string;
  ownerProjectId: string;
  sessionId: string;
  projectRoot: string;
  attestationMarker?: string;
};

const managers: WorkspaceRuntimeManager[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-lifecycle-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", scripts: { dev: "node server.mjs" } }),
  );
  return root;
}

function createSupervisor(
  start: (input: SupervisorStartInput) => Promise<SupervisorSession>,
  observeStartState?: (input: { projectId: string; ownerProjectId: string }) => Promise<SupervisorObservation>,
): WorkspaceRuntimeSupervisorClient {
  return {
    start: vi.fn(start),
    stop: vi.fn(async () => undefined),
    adopt: vi.fn(async (input: {
      projectId: string;
      sessionId: string;
      pid: number | null;
      port: number | null;
    }) => ({
      ...input,
      status: "running" as const,
    })),
    observeStartState: vi.fn(observeStartState ?? (async (input: { projectId: string; ownerProjectId: string }) => ({
      projectId: input.projectId,
      ownerProjectId: input.ownerProjectId,
      status: "stopped" as const,
      observedAt: new Date().toISOString(),
      inventoryComplete: true,
      unknownListenerPorts: [],
      detail: "No tracked runtime session is live.",
    }))),
  } as unknown as WorkspaceRuntimeSupervisorClient;
}

async function waitForPidExit(pid: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function spawnDetachedFixtureProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!child.pid) throw new Error("The isolated runtime process fixture did not start.");
  return child;
}

async function stopDetachedFixtureProcess(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

describe("Workspace Runtime lifecycle invariants", () => {
  it("does not let the same worker replace an active durable start", async () => {
    const store = createInMemoryWorkspaceRuntimeStore();
    const now = new Date();
    const first = await store.begin({
      projectId: "runtime-same-worker",
      projectRoot: "/tmp/runtime-same-worker",
      sessionId: "runtime-session-first",
      revision: "revision-1",
      environmentRevision: null,
      attestationBinding: null,
      attestationKeyVersion: null,
      workerId: "runtime-worker",
      now,
      leaseUntil: new Date(now.getTime() + 30_000),
    });
    const second = await store.begin({
      projectId: "runtime-same-worker",
      projectRoot: "/tmp/runtime-same-worker",
      sessionId: "runtime-session-second",
      revision: "revision-2",
      environmentRevision: null,
      attestationBinding: null,
      attestationKeyVersion: null,
      workerId: "runtime-worker",
      now: new Date(now.getTime() + 1),
      leaseUntil: new Date(now.getTime() + 30_001),
    });

    expect(first?.sessionId).toBe("runtime-session-first");
    expect(second).toBeUndefined();
    await expect(store.get("runtime-same-worker")).resolves.toMatchObject({
      sessionId: "runtime-session-first",
      workerId: "runtime-worker",
      status: "starting",
    });
  });

  it("serializes concurrent manager starts for the same project", async () => {
    const root = await createProjectRoot();
    const entered = deferred<void>();
    const releaseStart = deferred<void>();
    let startCalls = 0;
    const supervisor = createSupervisor(async ({ projectId, sessionId }) => {
      startCalls += 1;
      entered.resolve();
      await releaseStart.promise;
      return { projectId, sessionId, status: "running", port: 3_000, pid: process.pid };
    });
    const manager = new WorkspaceRuntimeManager({
      store: createInMemoryWorkspaceRuntimeStore(),
      workerId: "runtime-concurrent-manager",
      supervisor,
      heartbeatIntervalMs: 60_000,
    });
    managers.push(manager);
    const input = { projectId: "runtime-manager-lock", projectRoot: root, revision: "revision-1" };
    const firstStart = manager.start(input);
    const secondStart = manager.start(input);

    await entered.promise;
    expect(startCalls).toBe(1);
    releaseStart.resolve();
    const [first, second] = await Promise.all([firstStart, secondStart]);

    expect(startCalls).toBe(1);
    expect(first.status).toBe("running");
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("renews the lease while supervisor startup is still pending", async () => {
    const root = await createProjectRoot();
    const innerStore = createInMemoryWorkspaceRuntimeStore();
    const store: WorkspaceRuntimeStore = {
      ...innerStore,
      begin: (input) => innerStore.begin({
        ...input,
        leaseUntil: new Date(Date.now() + 40),
      }),
    };
    const entered = deferred<void>();
    const releaseStart = deferred<void>();
    const supervisor = createSupervisor(async ({ projectId, sessionId }) => {
      entered.resolve();
      await releaseStart.promise;
      return { projectId, sessionId, status: "running", port: 3_001, pid: process.pid };
    });
    const owner = new WorkspaceRuntimeManager({
      store,
      workerId: "runtime-start-owner",
      supervisor,
      heartbeatIntervalMs: 10,
    });
    const recoveryWorker = new WorkspaceRuntimeManager({ store, workerId: "runtime-start-recovery" });
    managers.push(owner, recoveryWorker);
    const start = owner.start({
      projectId: "runtime-slow-start",
      projectRoot: root,
      revision: "revision-1",
    });

    await entered.promise;
    await store.updateOwned("runtime-slow-start", "runtime-start-owner", {
      leaseUntil: new Date(Date.now() - 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const renewed = await store.get("runtime-slow-start");
    expect(renewed?.leaseUntil?.getTime()).toBeGreaterThan(Date.now());

    await recoveryWorker.recover();
    await expect(store.get("runtime-slow-start")).resolves.toMatchObject({
      workerId: "runtime-start-owner",
      status: "starting",
    });

    releaseStart.resolve();
    await expect(start).resolves.toMatchObject({ status: "running" });
  });

  it("reconciles a lost start response by retrying and observing the same session", async () => {
    const root = await createProjectRoot();
    const attempted: SupervisorStartInput[] = [];
    const startedSession: SupervisorSession = {
      projectId: "runtime-lost-start-response",
      sessionId: "pending",
      status: "running",
      port: 3_002,
      pid: process.pid,
      logs: ["server ready"],
    };
    const supervisor = createSupervisor(
      async (input) => {
        attempted.push(input);
        startedSession.projectId = input.projectId;
        startedSession.sessionId = input.sessionId;
        throw new Error("connection closed after supervisor start");
      },
      async (input) => ({
        projectId: input.projectId,
        ownerProjectId: input.ownerProjectId,
        status: "running",
        session: startedSession,
        observedAt: new Date().toISOString(),
        inventoryComplete: true,
        unknownListenerPorts: [],
        detail: "Matching tracked runtime session is live.",
      }),
    );
    const store = createInMemoryWorkspaceRuntimeStore();
    const manager = new WorkspaceRuntimeManager({
      store,
      workerId: "runtime-lost-response-worker",
      supervisor,
      heartbeatIntervalMs: 60_000,
    });
    managers.push(manager);

    const result = await manager.start({
      projectId: "runtime-lost-start-response",
      projectRoot: root,
      revision: "revision-1",
    });
    const row = await store.get("runtime-lost-start-response");

    expect(attempted).toHaveLength(2);
    expect(attempted[1]?.sessionId).toBe(attempted[0]?.sessionId);
    expect(result).toMatchObject({
      sessionId: attempted[0]?.sessionId,
      status: "running",
      port: 3_002,
      pid: process.pid,
    });
    expect(row).toMatchObject({
      sessionId: attempted[0]?.sessionId,
      status: "running",
      port: 3_002,
      pid: process.pid,
      workerId: "runtime-lost-response-worker",
    });
  });

  it("fails a lost start only after a complete stopped inventory and safely starts a new session", async () => {
    const root = await createProjectRoot();
    const projectId = "runtime-lost-response-definitively-stopped";
    const attempted: SupervisorStartInput[] = [];
    let lostStartProcess: ChildProcess | undefined;
    let retryProcess: ChildProcess | undefined;
    let observedStoppedInventory = false;
    const supervisor = createSupervisor(
      async (input) => {
        attempted.push(input);
        if (attempted.length === 1) {
          // Simulate a transient runtime that exited before its start reply arrived.
          lostStartProcess = await spawnDetachedFixtureProcess();
          await stopDetachedFixtureProcess(lostStartProcess);
        }
        if (attempted.length <= 2) {
          throw new Error("supervisor connection closed before the start reply arrived");
        }
        retryProcess = await spawnDetachedFixtureProcess();
        return {
          projectId: input.projectId,
          sessionId: input.sessionId,
          status: "running",
          port: 3_006,
          pid: retryProcess.pid!,
        };
      },
      async (observedProjectId) => {
        observedStoppedInventory = true;
        return {
          projectId: observedProjectId,
          status: "stopped",
          observedAt: new Date().toISOString(),
          inventoryComplete: true,
          unknownListenerPorts: [],
          detail: "Complete supervisor inventory confirms no session or unowned listener.",
        };
      },
    );
    supervisor.stop = vi.fn(async ({ pid }: { projectId: string; sessionId: string; pid: number | null }) => {
      if (retryProcess?.pid === pid) await stopDetachedFixtureProcess(retryProcess);
    });
    const store = createInMemoryWorkspaceRuntimeStore();
    const manager = new WorkspaceRuntimeManager({
      store,
      workerId: "runtime-lost-response-stopped-worker",
      supervisor,
      heartbeatIntervalMs: 60_000,
    });
    managers.push(manager);

    try {
      await expect(manager.start({
        projectId,
        projectRoot: root,
        revision: "revision-1",
      })).rejects.toMatchObject({
        code: "RUNTIME_START_FAILED",
        status: 502,
      });

      const failedRow = await store.get(projectId);
      expect(attempted).toHaveLength(2);
      expect(attempted[1]?.sessionId).toBe(attempted[0]?.sessionId);
      expect(observedStoppedInventory).toBe(true);
      expect(supervisor.observeStartState).toHaveBeenCalledWith({ projectId, ownerProjectId: projectId });
      expect(failedRow).toMatchObject({
        sessionId: attempted[0]?.sessionId,
        status: "failed",
        pid: null,
        port: null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        error: "supervisor connection closed before the start reply arrived",
      });
      expect(lostStartProcess?.pid).toBeDefined();
      await expect(waitForPidExit(lostStartProcess!.pid!)).resolves.toBe(true);

      const restarted = await manager.start({
        projectId,
        projectRoot: root,
        revision: "revision-2",
      });
      const runningRow = await store.get(projectId);
      expect(attempted).toHaveLength(3);
      expect(attempted[2]?.sessionId).not.toBe(attempted[0]?.sessionId);
      expect(restarted).toMatchObject({
        sessionId: attempted[2]?.sessionId,
        status: "running",
        pid: retryProcess?.pid,
        port: 3_006,
      });
      expect(runningRow).toMatchObject({
        sessionId: attempted[2]?.sessionId,
        status: "running",
        workerId: "runtime-lost-response-stopped-worker",
        pid: retryProcess?.pid,
        port: 3_006,
      });

      await expect(manager.stop(projectId)).resolves.toMatchObject({
        sessionId: attempted[2]?.sessionId,
        status: "stopped",
      });
      await expect(waitForPidExit(retryProcess!.pid!)).resolves.toBe(true);
    } finally {
      if (lostStartProcess) await stopDetachedFixtureProcess(lostStartProcess);
      if (retryProcess) await stopDetachedFixtureProcess(retryProcess);
    }
  });

  it("retains and later reconciles a start whose supervisor outcome is unknown", async () => {
    const root = await createProjectRoot();
    let observationStatus: SupervisorObservation["status"] = "unknown";
    let session: SupervisorSession = {
      projectId: "runtime-unknown-start",
      sessionId: "pending",
      status: "running",
      port: 3_004,
      pid: process.pid,
      logs: [],
    };
    const supervisor = createSupervisor(
      async (input) => {
        session = { ...session, projectId: input.projectId, sessionId: input.sessionId };
        throw new Error("supervisor connection interrupted");
      },
      async (input) => ({
        projectId: input.projectId,
        ownerProjectId: input.ownerProjectId,
        status: observationStatus,
        ...(observationStatus === "running" ? { session } : {}),
        observedAt: new Date().toISOString(),
        inventoryComplete: true,
        unknownListenerPorts: observationStatus === "unknown" ? [3_005] : [],
        detail: "Start state observation.",
      }),
    );
    const store = createInMemoryWorkspaceRuntimeStore();
    const manager = new WorkspaceRuntimeManager({
      store,
      workerId: "runtime-unknown-start-worker",
      supervisor,
      heartbeatIntervalMs: 15,
    });
    managers.push(manager);

    await expect(manager.start({
      projectId: "runtime-unknown-start",
      projectRoot: root,
      revision: "revision-1",
    })).rejects.toMatchObject({
      code: "RUNTIME_START_UNRESOLVED",
      status: 503,
    });
    await expect(store.get("runtime-unknown-start")).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: "starting",
      workerId: "runtime-unknown-start-worker",
      pid: null,
      port: null,
    });
    const unresolvedRow = await store.get("runtime-unknown-start");
    if (!unresolvedRow) throw new Error("Unresolved runtime row was not retained.");
    await store.updateOwnedSession(
      "runtime-unknown-start",
      session.sessionId,
      "runtime-unknown-start-worker",
      { startedAt: new Date(Date.now() - UNRESOLVED_RUNTIME_START_ALERT_MS - 100) },
      "starting",
    );
    const alertHealth = await manager.getUnresolvedStartHealth();
    expect(alertHealth).toMatchObject({
      status: "alert",
      thresholdMs: UNRESOLVED_RUNTIME_START_ALERT_MS,
      unresolvedCount: 1,
    });
    expect(alertHealth.oldestAgeMs).toBeGreaterThanOrEqual(UNRESOLVED_RUNTIME_START_ALERT_MS);
    await expect(store.get("runtime-unknown-start")).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: "starting",
      workerId: "runtime-unknown-start-worker",
      leaseUntil: expect.any(Date),
    });
    const boundaryStartedAt = new Date("2026-01-01T00:00:00.000Z");
    expect(getUnresolvedRuntimeStartAlert({
      status: "starting",
      startedAt: boundaryStartedAt.toISOString(),
    }, new Date(boundaryStartedAt.getTime() + UNRESOLVED_RUNTIME_START_ALERT_MS - 1))).toBeNull();
    expect(getUnresolvedRuntimeStartAlert({
      status: "starting",
      startedAt: boundaryStartedAt.toISOString(),
    }, new Date(boundaryStartedAt.getTime() + UNRESOLVED_RUNTIME_START_ALERT_MS))).toMatchObject({
      status: "alert",
      ageMs: UNRESOLVED_RUNTIME_START_ALERT_MS,
      thresholdMs: UNRESOLVED_RUNTIME_START_ALERT_MS,
    });
    expect(getUnresolvedRuntimeStartAlert({
      status: "failed",
      startedAt: boundaryStartedAt.toISOString(),
    }, new Date(boundaryStartedAt.getTime() + UNRESOLVED_RUNTIME_START_ALERT_MS))).toBeNull();
    await expect(manager.getProjectUnresolvedStartAlert(
      "runtime-unknown-start",
      new Date(Date.now() + UNRESOLVED_RUNTIME_START_ALERT_MS),
    )).resolves.toMatchObject({
      status: "alert",
      thresholdMs: UNRESOLVED_RUNTIME_START_ALERT_MS,
    });

    observationStatus = "running";
    let reconciled = await store.get("runtime-unknown-start");
    const deadline = Date.now() + 1_000;
    while (reconciled?.status !== "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      reconciled = await store.get("runtime-unknown-start");
    }
    expect(reconciled).toMatchObject({
      sessionId: session.sessionId,
      status: "running",
      workerId: "runtime-unknown-start-worker",
      pid: process.pid,
      port: 3_004,
    });
    await expect(manager.getUnresolvedStartHealth()).resolves.toMatchObject({
      status: "clear",
      thresholdMs: UNRESOLVED_RUNTIME_START_ALERT_MS,
      unresolvedCount: 0,
      oldestAgeMs: null,
    });
    await expect(manager.getProjectUnresolvedStartAlert("runtime-unknown-start")).resolves.toBeNull();
    expect(getUnresolvedRuntimeStartAlert({
      status: "running",
      startedAt: new Date(0).toISOString(),
    })).toBeNull();

    await expect(manager.stop("runtime-unknown-start")).resolves.toMatchObject({
      sessionId: session.sessionId,
      status: "stopped",
    });
    await expect(manager.getUnresolvedStartHealth()).resolves.toMatchObject({
      status: "clear",
      unresolvedCount: 0,
      oldestAgeMs: null,
    });
  });

  it("retries stop after a rejected supervisor stop promise", async () => {
    const root = await createProjectRoot();
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        'import http from "node:http";',
        'const server = http.createServer((_req, res) => res.end("runtime-stop-retry"));',
        'server.listen(Number(process.env.PORT), "127.0.0.1");',
        'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
      ].join("\n"),
    );
    const manager = new WorkspaceRuntimeManager();
    managers.push(manager);
    const started = await manager.start({
      projectId: "runtime-stop-retry",
      projectRoot: root,
      revision: "revision-1",
    });
    expect(started.status).toBe("running");

    const mutableManager = manager as unknown as {
      supervisor?: WorkspaceRuntimeSupervisorClient;
    };
    mutableManager.supervisor = {
      stop: vi.fn(async () => {
        throw new Error("temporary supervisor stop failure");
      }),
    } as unknown as WorkspaceRuntimeSupervisorClient;
    await expect(manager.stop("runtime-stop-retry")).rejects.toThrow("temporary supervisor stop failure");
    await expect(manager.get("runtime-stop-retry")).resolves.toMatchObject({ status: "running" });

    mutableManager.supervisor = undefined;
    await expect(manager.stop("runtime-stop-retry")).resolves.toMatchObject({ status: "stopped" });
    if (started.pid) await expect(waitForPidExit(started.pid)).resolves.toBe(true);
  }, 10_000);

  it.skipIf(process.platform !== "linux")(
    "kills a surviving process group during recovery after its leader exits",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-recovery-group-"));
      roots.push(root);
      const descendantPidPath = path.join(root, "descendant.pid");
      const leaderPath = path.join(root, "leader.mjs");
      const childCode = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
      await fs.writeFile(
        leaderPath,
        [
          'import { spawn } from "node:child_process";',
          'import { writeFileSync } from "node:fs";',
          `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" });`,
          `writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid));`,
          "setTimeout(() => process.exit(0), 30);",
        ].join("\n"),
      );
      const leader = spawn(process.execPath, [leaderPath], {
        cwd: root,
        detached: true,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp" },
        stdio: "ignore",
      });
      if (!leader.pid) throw new Error("Recovery process-group fixture did not start.");
      const leaderPid = leader.pid;
      await new Promise<void>((resolve, reject) => {
        leader.once("error", reject);
        leader.once("exit", () => resolve());
      });
      const descendantPid = Number(await fs.readFile(descendantPidPath, "utf8"));
      expect(descendantPid).toBeGreaterThan(1);

      const store = createInMemoryWorkspaceRuntimeStore();
      const oldNow = new Date(Date.now() - 60_000);
      await store.begin({
        projectId: "runtime-orphan-recovery",
        projectRoot: root,
        sessionId: "runtime-orphan-session",
        revision: "revision-1",
        environmentRevision: null,
        attestationBinding: null,
        attestationKeyVersion: null,
        workerId: "expired-runtime-worker",
        now: oldNow,
        leaseUntil: new Date(Date.now() - 1),
      });
      await store.updateOwned("runtime-orphan-recovery", "expired-runtime-worker", {
        status: "running",
        pid: leaderPid,
        port: 3_003,
      });
      const manager = new WorkspaceRuntimeManager({
        store,
        workerId: "runtime-recovery-worker",
      });
      managers.push(manager);

      try {
        await manager.recover("runtime-orphan-recovery");
        await expect(waitForPidExit(descendantPid, 3_000)).resolves.toBe(true);
        await expect(store.get("runtime-orphan-recovery")).resolves.toMatchObject({
          status: "failed",
          workerId: null,
          leaseUntil: null,
        });
      } finally {
        try {
          process.kill(-leaderPid, "SIGKILL");
        } catch {
          // The isolated process group is already gone.
        }
      }
    },
    10_000,
  );
});
