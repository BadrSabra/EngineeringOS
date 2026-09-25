import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import { createInMemoryWorkspaceRuntimeStore } from "./workspace-runtime-store.js";

const managers: WorkspaceRuntimeManager[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("WorkspaceRuntimeManager", () => {
  it("starts a server-owned dev profile and stops its process group", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "workspace-runtime-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', 'revision-1'); res.end('runtime-ok marker-1'); });",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "console.log('runtime fixture ready');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const manager = new WorkspaceRuntimeManager();
    managers.push(manager);
    const attestationIdentity = {
      projectId: "project-runtime-test",
      operationId: "operation-runtime-test",
      executionId: "execution-runtime-test",
      executionAttempt: 1,
      episodeId: "episode-runtime-test",
      revision: "revision-1",
    };
    const started = await manager.start({
      projectId: "project-runtime-test",
      projectRoot: root,
      revision: "revision-1",
      attestationIdentity,
    });

    expect(started.status, started.error ?? "runtime did not start").toBe("running");
    expect(started.port).toBeGreaterThanOrEqual(3000);
    expect(started.port).toBeLessThanOrEqual(3099);
    expect(started.command).toBe("pnpm run dev");
    expect(started.environmentRevision).toMatch(/^env-v1:[a-f0-9]{64}$/);

    const afterState = await manager.observeAfterState({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
      attestationBinding: { ...attestationIdentity, sessionId: started.sessionId! },
      expectedMarker: "marker-1",
    });
    expect(afterState).toMatchObject({
      status: "passed",
      projectId: "project-runtime-test",
      sessionId: started.sessionId,
      revision: "revision-1",
      port: started.port,
      processAlive: true,
      portReady: true,
      healthStatus: 200,
      servingRevision: "revision-1",
      markerMatched: true,
      childProcessAttestation: {
        status: "known",
        reasonCode: "child_process_observed",
      },
      listener: {
        status: "known",
        reasonCode: "listener_process_attested",
        port: started.port,
        processAttestation: {
          status: "known",
          reasonCode: "child_process_observed",
        },
      },
    });
    expect(afterState.childProcessAttestation?.bindingDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.childProcessAttestation?.attestationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.childProcessAttestation?.processEnvironmentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.listener.identityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.listener.processAttestation.bindingDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.listener.processAttestation.attestationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(afterState.listener.processAttestation.processEnvironmentDigest).toMatch(/^[a-f0-9]{64}$/);

    const beforeStop = await manager.observeRunningBeforeStop({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
      pid: started.pid!,
      port: started.port!,
    });
    expect(beforeStop).toMatchObject({
      status: "passed",
      sessionId: started.sessionId,
      revision: "revision-1",
      pid: started.pid,
      port: started.port,
      processAlive: true,
      portReady: true,
      healthStatus: 200,
      servingRevision: "revision-1",
      listener: {
        status: "known",
        port: started.port,
      },
    });

    const stopped = await manager.stop("project-runtime-test");
    expect(stopped.status).toBe("stopped");
    expect(stopped.pid).toBeNull();
    const stoppedAfter = await manager.observeStoppedAfterState({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
      pid: started.pid!,
      port: started.port!,
    });
    expect(stoppedAfter).toMatchObject({
      status: "passed",
      sessionId: started.sessionId,
      revision: "revision-1",
      pid: started.pid,
      port: started.port,
      processAlive: false,
      portReady: false,
      listener: {
        status: "unknown",
        port: null,
      },
    });
    await expect(manager.observeStoppedAfterState({
      projectId: "project-runtime-test",
      sessionId: "wrong-session",
      revision: "revision-1",
      pid: started.pid!,
      port: started.port!,
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await expect(manager.observeStoppedAfterState({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
      pid: 0,
      port: started.port!,
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await expect(manager.observeStoppedAfterState({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
      pid: started.pid!,
      port: 0,
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await expect(manager.observeStoppedAfterState({
      projectId: "project-runtime-test",
      sessionId: started.sessionId!,
      revision: "wrong-revision",
      pid: started.pid!,
      port: started.port!,
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("fails closed when the socket owner does not inherit the server marker", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "workspace-runtime-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "env -u ENGINEERINGOS_CHILD_ATTESTATION node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', 'revision-1'); res.end('runtime-mismatch'); });",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const manager = new WorkspaceRuntimeManager();
    managers.push(manager);
    const attestationIdentity = {
      projectId: "project-runtime-marker-mismatch",
      operationId: "operation-runtime-marker-mismatch",
      executionId: "execution-runtime-marker-mismatch",
      executionAttempt: 1,
      episodeId: "episode-runtime-marker-mismatch",
      revision: "revision-1",
    };
    const started = await manager.start({
      projectId: attestationIdentity.projectId,
      projectRoot: root,
      revision: attestationIdentity.revision,
      attestationIdentity,
    });
    expect(started.status).toBe("running");

    const afterState = await manager.observeAfterState({
      projectId: attestationIdentity.projectId,
      sessionId: started.sessionId!,
      revision: attestationIdentity.revision,
      attestationBinding: { ...attestationIdentity, sessionId: started.sessionId! },
    });
    expect(afterState.status).toBe("failed");
    expect(afterState.listener).toMatchObject({
      status: "mismatch",
      reasonCode: "child_environment_mismatch",
      processAttestation: {
        status: "mismatch",
        reasonCode: "child_environment_mismatch",
      },
    });

    const stopped = await manager.stop(attestationIdentity.projectId);
    expect(stopped.status).toBe("stopped");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects an after-state observation for a stale runtime session", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "workspace-runtime-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => res.end('runtime-ok'));",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );
    const store = createInMemoryWorkspaceRuntimeStore();
    const manager = new WorkspaceRuntimeManager({ store, workerId: "stale-runtime-worker" });
    managers.push(manager);
    const started = await manager.start({
      projectId: "stale-runtime-test",
      projectRoot: root,
      revision: "revision-1",
    });

    await expect(manager.observeAfterState({
      projectId: "stale-runtime-test",
      sessionId: "old-session",
      revision: "revision-1",
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await expect(manager.observeAfterState({
      projectId: "stale-runtime-test",
      sessionId: started.sessionId!,
      revision: "different-revision",
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });
    await store.releaseWorker("stale-runtime-worker");
    await expect(manager.observeAfterState({
      projectId: "stale-runtime-test",
      sessionId: started.sessionId!,
      revision: "revision-1",
    })).rejects.toMatchObject({ code: "RUNTIME_OBSERVATION_STALE" });

    await manager.stop("stale-runtime-test");
    await fs.rm(root, { recursive: true, force: true });
    expect(started.status, started.error ?? "runtime did not start").toBe("running");
  });

  it("rejects projects without an explicit dev script", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} }));
    const manager = new WorkspaceRuntimeManager();
    managers.push(manager);

    await expect(manager.start({
      projectId: "project-without-dev",
      projectRoot: root,
      revision: "revision-1",
    })).rejects.toMatchObject({ code: "DEV_SCRIPT_MISSING" });

    await fs.rm(root, { recursive: true, force: true });
  });

  it("adopts a live process after the owning API worker is replaced", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "workspace-runtime-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', 'revision-1'); res.end('runtime-recovery-ok'); });",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const store = createInMemoryWorkspaceRuntimeStore();
    const firstWorker = new WorkspaceRuntimeManager({ store, workerId: "worker-a" });
    const secondWorker = new WorkspaceRuntimeManager({ store, workerId: "worker-b" });
    managers.push(firstWorker, secondWorker);
    const attestationIdentity = {
      projectId: "recoverable-project",
      operationId: "operation-runtime-recovery",
      executionId: "execution-runtime-recovery",
      executionAttempt: 2,
      episodeId: "episode-runtime-recovery",
      revision: "revision-1",
    };
    const started = await firstWorker.start({
      projectId: "recoverable-project",
      projectRoot: root,
      revision: "revision-1",
      attestationIdentity,
    });
    expect(started.status).toBe("running");
    expect(started.environmentRevision).toMatch(/^env-v1:[a-f0-9]{64}$/);

    await firstWorker.shutdown({ preserveProcesses: true });
    await secondWorker.recover();
    const adopted = await secondWorker.get("recoverable-project");
    expect(adopted.status).toBe("running");
    expect(adopted.environmentRevision).toBe(started.environmentRevision);
    expect(adopted.pid).toBe(started.pid);
    expect(adopted.port).toBe(started.port);
    const afterRecovery = await secondWorker.observeAfterState({
      projectId: "recoverable-project",
      sessionId: started.sessionId!,
      revision: "revision-1",
      attestationBinding: { ...attestationIdentity, sessionId: started.sessionId! },
    });
    expect(afterRecovery).toMatchObject({
      status: "failed",
      sessionId: started.sessionId,
      revision: "revision-1",
      processAlive: true,
      portReady: true,
      healthStatus: 200,
      servingRevision: "revision-1",
      childProcessAttestation: {
        status: "unknown",
        reasonCode: "marker_unavailable",
      },
      listener: {
        status: "unknown",
        reasonCode: "marker_unavailable",
      },
    });

    const stopped = await secondWorker.stop("recoverable-project");
    expect(stopped.status).toBe("stopped");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("retries recovery and heartbeat after unknown listener ownership without killing the runtime", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "workspace-runtime-"));
    roots.push(root);
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', 'revision-1'); res.end('runtime-retry-ok'); });",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const store = createInMemoryWorkspaceRuntimeStore();
    const firstWorker = new WorkspaceRuntimeManager({ store, workerId: "retry-worker-a" });
    let listenerOwnership: "known" | "unknown" = "unknown";
    const secondWorker = new WorkspaceRuntimeManager({
      store,
      workerId: "retry-worker-b",
      heartbeatIntervalMs: 20,
      listenerResolver: async ({ launchPid, port }) => listenerOwnership === "known"
        ? {
            status: "known" as const,
            reasonCode: "listener_owned_by_runtime_process" as const,
            port,
            pid: typeof launchPid === "number" ? launchPid : 1,
            identityDigest: "a".repeat(64),
            observedAt: new Date().toISOString(),
          }
        : {
            status: "unknown" as const,
            reasonCode: "listener_not_in_runtime_tree" as const,
            port: null,
            pid: null,
            identityDigest: null,
            observedAt: new Date().toISOString(),
          },
    });
    managers.push(firstWorker, secondWorker);
    const started = await firstWorker.start({
      projectId: "recoverable-runtime-retry",
      projectRoot: root,
      revision: "revision-1",
      attestationIdentity: {
        projectId: "recoverable-runtime-retry",
        operationId: "operation-runtime-retry",
        executionId: "execution-runtime-retry",
        executionAttempt: 1,
        episodeId: "episode-runtime-retry",
        revision: "revision-1",
      },
    });
    expect(started.status).toBe("running");
    await firstWorker.shutdown({ preserveProcesses: true });

    await secondWorker.recover();
    let row = await store.get("recoverable-runtime-retry");
    expect(row).toMatchObject({
      status: "running",
      workerId: null,
      leaseUntil: null,
      pid: started.pid,
      port: started.port,
    });
    expect(await fetch(`http://127.0.0.1:${started.port}`).then((response) => response.text()))
      .toBe("runtime-retry-ok");

    listenerOwnership = "known";
    await secondWorker.recover();
    expect((await secondWorker.get("recoverable-runtime-retry")).leaseUntil).not.toBeNull();

    listenerOwnership = "unknown";
    const retryDeadline = Date.now() + 2_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      row = await store.get("recoverable-runtime-retry");
    } while (row?.workerId && Date.now() < retryDeadline);
    expect(row).toMatchObject({
      status: "running",
      workerId: null,
      leaseUntil: null,
      pid: started.pid,
      port: started.port,
    });
    expect(await fetch(`http://127.0.0.1:${started.port}`).then((response) => response.text()))
      .toBe("runtime-retry-ok");

    await expect(secondWorker.start({
      projectId: "recoverable-runtime-retry",
      projectRoot: root,
      revision: "revision-2",
      restart: true,
    })).rejects.toMatchObject({ code: "RUNTIME_OWNERSHIP_BUSY" });
    expect((await store.get("recoverable-runtime-retry"))?.sessionId).toBe(started.sessionId);
    expect(await fetch(`http://127.0.0.1:${started.port}`).then((response) => response.text()))
      .toBe("runtime-retry-ok");

    const stopWhileUnknown = await secondWorker.stop("recoverable-runtime-retry");
    expect(stopWhileUnknown.status).toBe("running");
    expect(await fetch(`http://127.0.0.1:${started.port}`).then((response) => response.text()))
      .toBe("runtime-retry-ok");

    listenerOwnership = "known";
    const stopped = await secondWorker.stop("recoverable-runtime-retry");
    expect(stopped.status).toBe("stopped");
  });
});