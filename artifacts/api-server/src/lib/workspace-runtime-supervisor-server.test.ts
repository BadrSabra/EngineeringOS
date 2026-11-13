import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeListenerProcess } from "./agent-state/runtime-listener-process.js";
import { deriveWorkspaceRuntimeSupervisorToken } from "./workspace-runtime-supervisor-client.js";

const testSecret = "supervisor-test-secret-that-is-not-used-outside-this-test";
const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/workspace-runtime-supervisor.mjs",
);
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a supervisor test port.");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function freeManagedRuntimePort(): Promise<number> {
  for (let port = 3_000; port <= 3_099; port += 1) {
    const server = createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close((error) => resolve(!error));
      });
    });
    if (available) return port;
  }
  throw new Error("No managed runtime port is available for the test.");
}

async function runtimeAdoptionProof(pid: number, port: number) {
  const listenerBindingDigest = "a".repeat(64);
  const resolution = await resolveRuntimeListenerProcess({
    launchPid: pid,
    port,
    bindingDigest: listenerBindingDigest,
  });
  if (resolution.status !== "known" || !resolution.identityDigest) {
    throw new Error(`Runtime fixture listener could not be resolved: ${resolution.reasonCode}.`);
  }
  return {
    listenerBindingDigest,
    expectedListenerIdentityDigest: resolution.identityDigest,
  };
}

function startSupervisor(port: number, extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      SESSION_SECRET: testSecret,
      WORKSPACE_RUNTIME_SUPERVISOR_PORT: String(port),
      WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON: JSON.stringify([tmpdir()]),
      ...extraEnv,
    },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

async function waitForHealth(child: ChildProcess, port: number): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Supervisor exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // The child has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Workspace runtime supervisor did not become ready.");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    return state !== "Z" && state !== "X";
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }
}

async function readProcessGroupId(pid: number): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(fields[2]);
  } catch {
    return null;
  }
}

function isProcessGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !await isProcessRunning(pid);
}

async function waitForRuntimePort(port: number): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // The isolated runtime has not opened its listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Isolated runtime did not open its listener.");
}

async function startOrphaningRuntimeGroup(projectRoot: string, runtimePort: number, suffix: string) {
  const descendantPidFile = path.join(projectRoot, `${suffix}.pid`);
  const descendantReadyFile = path.join(projectRoot, `${suffix}.ready`);
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ scripts: { dev: "node leader.mjs" } }),
  );
  await writeFile(
    path.join(projectRoot, "descendant.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'process.on("SIGTERM", () => {});',
      'writeFileSync(process.env.TEST_CHILD_READY_FILE, "ready");',
      'setInterval(() => {}, 1000);',
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "leader.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'import { createServer } from "node:http";',
      'import path from "node:path";',
      'const descendant = spawn(process.execPath, [path.join(process.cwd(), "descendant.mjs")], { stdio: "ignore" });',
      'writeFileSync(process.env.TEST_DESCENDANT_PID_FILE, String(descendant.pid));',
      'const server = createServer((_request, response) => response.end("ready"));',
      'server.listen(Number(process.env.TEST_RUNTIME_PORT), "127.0.0.1");',
      'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
      'setInterval(() => {}, 1000);',
    ].join("\n"),
  );

  const leader = spawn(process.execPath, [path.join(projectRoot, "leader.mjs")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TEST_RUNTIME_PORT: String(runtimePort),
      TEST_DESCENDANT_PID_FILE: descendantPidFile,
      TEST_CHILD_READY_FILE: descendantReadyFile,
    },
    detached: true,
    stdio: "ignore",
  });
  children.push(leader);
  const leaderPid = leader.pid;
  if (!leaderPid) throw new Error("Isolated runtime leader did not start.");
  await waitForRuntimePort(runtimePort);

  const descendantPid = Number(await readFile(descendantPidFile, "utf8"));
  if (
    descendantPid <= 1
    || await readProcessGroupId(descendantPid) !== leaderPid
    || !await isProcessRunning(descendantPid)
  ) {
    throw new Error("Isolated descendant is not in the expected process group.");
  }
  const descendantReadyDeadline = Date.now() + 2_000;
  while (Date.now() < descendantReadyDeadline) {
    try {
      if ((await readFile(descendantReadyFile, "utf8")) === "ready") {
        return { leader, leaderPid, descendantPid };
      }
    } catch {
      // The descendant has not installed its signal handler yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Isolated descendant did not install its signal handler.");
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
});

describe("workspace runtime supervisor server boundary", () => {
  it("requires service authentication for every control request", async () => {
    const port = await freePort();
    const child = startSupervisor(port);
    await waitForHealth(child, port);

    const unauthorized = await fetch(`http://127.0.0.1:${port}/runtime/observe-start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "test-project" }),
    });
    expect(unauthorized.status).toBe(401);

    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
    const authorized = await fetch(`http://127.0.0.1:${port}/runtime/observe-start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ projectId: "test-project" }),
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      projectId: "test-project",
      inventoryComplete: true,
    });
  });

  it("rejects project roots outside the configured workspace before spawning", async () => {
    const supervisorPort = await freePort();
    const allowedRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-allowed-root-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-outside-root-"));
    const supervisor = startSupervisor(supervisorPort, {
      WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON: JSON.stringify([allowedRoot]),
    });
    try {
      await writeFile(
        path.join(outsideRoot, "package.json"),
        JSON.stringify({ scripts: { dev: "node server.mjs" } }),
      );
      await writeFile(
        path.join(outsideRoot, "server.mjs"),
        [
          'import { writeFileSync } from "node:fs";',
          'import { createServer } from "node:http";',
          'writeFileSync(new URL("./started.txt", import.meta.url), "started");',
          'createServer((_req, res) => res.end("unexpected")).listen(Number(process.env.PORT), "127.0.0.1");',
        ].join("\\n"),
      );
      await waitForHealth(supervisor, supervisorPort);
      const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
      const response = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: "outside-workspace-project",
          sessionId: "outside-workspace-session",
          projectRoot: outsideRoot,
          profile: "dev",
        }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "The registered project root is unavailable or outside the configured workspace.",
      });

      await expect(
        readFile(path.join(outsideRoot, "started.txt"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("does not forward npm_config credentials into project runtime processes", async () => {
    const supervisorPort = await freePort();
    const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-env-policy-"));
    const supervisor = startSupervisor(supervisorPort, {
      npm_config_token: "riso-test-token-must-not-be-forwarded",
      npm_config_password: "riso-test-password-must-not-be-forwarded",
    });
    let sessionStarted = false;
    const projectId = "runtime-env-policy-project";
    const sessionId = "runtime-env-policy-session";
    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ type: "module", scripts: { dev: "node server.mjs" } }),
      );
      await writeFile(
        path.join(projectRoot, "server.mjs"),
        [
          'import { writeFileSync } from "node:fs";',
          'import { createServer } from "node:http";',
          'writeFileSync(new URL("./runtime-env.json", import.meta.url), JSON.stringify({ token: process.env.npm_config_token ?? null, password: process.env.npm_config_password ?? null }));',
          'const server = createServer((_req, res) => res.end("runtime-ready"));',
          'server.listen(Number(process.env.PORT), "127.0.0.1");',
          'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
        ].join("\n"),
      );
      await waitForHealth(supervisor, supervisorPort);

      const response = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, sessionId, projectRoot, profile: "dev" }),
      });
      expect(response.status).toBe(200);
      sessionStarted = true;
      await expect(response.json()).resolves.toMatchObject({
        projectId,
        sessionId,
        status: "running",
      });
      await expect(
        readFile(path.join(projectRoot, "runtime-env.json"), "utf8").then((value) => JSON.parse(value)),
      ).resolves.toEqual({ token: null, password: null });
    } finally {
      if (sessionStarted) {
        await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId, sessionId }),
        }).catch(() => undefined);
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses non-loopback binding even when authentication is configured", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "/tmp",
        SESSION_SECRET: testSecret,
        WORKSPACE_RUNTIME_SUPERVISOR_PORT: "8098",
        WORKSPACE_RUNTIME_SUPERVISOR_HOST: "0.0.0.0",
      },
      timeout: 3_000,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("must bind to a loopback address");
  });

  it("does not signal a PID when the session is not supervisor-owned", async () => {
    const port = await freePort();
    const child = startSupervisor(port);
    await waitForHealth(child, port);
    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);

    const response = await fetch(`http://127.0.0.1:${port}/runtime/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        projectId: "test-project",
        sessionId: "test-session",
        pid: 12345,
      }),
    });
    expect(response.status).toBe(409);
  });

  it("keeps a corroborated live session running when another listener is unowned", async () => {
    const supervisorPort = await freePort();
    const supervisor = startSupervisor(supervisorPort);
    const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-unknown-listener-"));
    const unownedListener = createServer();
    const projectId = "unknown-listener-project";
    const sessionId = "unknown-listener-session";
    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
    let sessionStarted = false;

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ type: "module", scripts: { dev: "node server.mjs" } }),
      );
      await writeFile(
        path.join(projectRoot, "server.mjs"),
        [
          'import http from "node:http";',
          'const server = http.createServer((_req, res) => res.end("runtime-ready"));',
          'server.listen(Number(process.env.PORT), "127.0.0.1");',
          'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
        ].join("\n"),
      );
      await waitForHealth(supervisor, supervisorPort);

      const startResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId, sessionId, projectRoot, profile: "dev" }),
      });
      expect(startResponse.status).toBe(200);
      sessionStarted = true;

      const unownedPort = await freeManagedRuntimePort();
      await new Promise<void>((resolve, reject) => {
        unownedListener.once("error", reject);
        unownedListener.listen({ host: "127.0.0.1", port: unownedPort }, resolve);
      });

      const observationResponse = await fetch(
        `http://127.0.0.1:${supervisorPort}/runtime/observe-start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId }),
        },
      );
      expect(observationResponse.status).toBe(200);
      const observation = await observationResponse.json() as {
        projectId: string;
        status: string;
        inventoryComplete: boolean;
        unknownListenerPorts: number[];
        session: { projectId: string; sessionId: string; status: string };
      };
      expect(observation).toMatchObject({
        projectId,
        status: "running",
        inventoryComplete: true,
        session: {
          projectId,
          sessionId,
          status: "running",
        },
      });
      expect(observation.unknownListenerPorts).toContain(unownedPort);
    } finally {
      if (sessionStarted) {
        await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId, sessionId }),
        }).catch(() => undefined);
      }
      if (unownedListener.listening) {
        await new Promise<void>((resolve, reject) => {
          unownedListener.close((error) => error ? reject(error) : resolve());
        });
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports unknown without a tracked session when a managed listener is unowned", async () => {
    const supervisorPort = await freePort();
    const supervisor = startSupervisor(supervisorPort);
    const unownedListener = createServer();
    const projectId = "unknown-listener-project";
    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
    let unownedPort: number | undefined;

    try {
      await waitForHealth(supervisor, supervisorPort);
      unownedPort = await freeManagedRuntimePort();
      await new Promise<void>((resolve, reject) => {
        unownedListener.once("error", reject);
        unownedListener.listen({ host: "127.0.0.1", port: unownedPort }, resolve);
      });

      const observationResponse = await fetch(
        `http://127.0.0.1:${supervisorPort}/runtime/observe-start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId }),
        },
      );
      expect(observationResponse.status).toBe(200);
      const observation = await observationResponse.json() as {
        projectId: string;
        status: string;
        inventoryComplete: boolean;
        unknownListenerPorts: number[];
      };
      expect(observation).toMatchObject({
        projectId,
        status: "unknown",
        inventoryComplete: true,
      });
      expect(observation.unknownListenerPorts).toContain(unownedPort);
      expect(observation).not.toHaveProperty("session");
    } finally {
      if (unownedListener.listening) {
        await new Promise<void>((resolve, reject) => {
          unownedListener.close((error) => error ? reject(error) : resolve());
        });
      }
    }
  });

  it("serializes concurrent starts for the same project", async () => {
    const supervisorPort = await freePort();
    const supervisor = startSupervisor(supervisorPort);
    const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-concurrent-start-"));
    const sessionIds = ["concurrent-session-a", "concurrent-session-b"];
    const startedSessions: Array<{ projectId: string; sessionId: string; pid: number | null }> = [];
    const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ type: "module", scripts: { dev: "node server.mjs" } }),
      );
      await writeFile(
        path.join(projectRoot, "server.mjs"),
        [
          'import http from "node:http";',
          'const server = http.createServer((_req, res) => res.end("runtime-ready"));',
          'server.listen(Number(process.env.PORT), "127.0.0.1");',
          'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
        ].join("\n"),
      );
      await waitForHealth(supervisor, supervisorPort);

      const responses = await Promise.all(sessionIds.map((sessionId) => fetch(
        `http://127.0.0.1:${supervisorPort}/runtime/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: "concurrent-start-project",
            sessionId,
            projectRoot,
            profile: "dev",
          }),
        },
      )));
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      for (const response of responses) {
        if (!response.ok) continue;
        const session = await response.json() as {
          projectId: string;
          sessionId: string;
          pid: number | null;
        };
        startedSessions.push(session);
      }
      expect(startedSessions).toHaveLength(1);
    } finally {
      for (const session of startedSessions) {
        try {
          await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              projectId: session.projectId,
              sessionId: session.sessionId,
            }),
          });
        } catch {
          // The supervisor may already be stopping during test cleanup.
        }
        if (session.pid) {
          try {
            process.kill(-session.pid, "SIGKILL");
          } catch {
            // The runtime process group is already gone.
          }
        }
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("refuses to adopt a live PID when another process owns the listening port", async () => {
    const supervisorPort = await freePort();
    const runtimePort = await freeManagedRuntimePort();
    const supervisor = startSupervisor(supervisorPort);
    const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-adopt-owner-"));
    let unrelatedLauncher: ChildProcess | undefined;
    let runtime: Awaited<ReturnType<typeof startOrphaningRuntimeGroup>> | undefined;

    try {
      await waitForHealth(supervisor, supervisorPort);
      runtime = await startOrphaningRuntimeGroup(projectRoot, runtimePort, "owner-mismatch");
      unrelatedLauncher = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
      });
      children.push(unrelatedLauncher);
      if (!unrelatedLauncher.pid) throw new Error("Unrelated runtime launcher did not start.");
      await new Promise<void>((resolve, reject) => {
        unrelatedLauncher!.once("spawn", () => resolve());
        unrelatedLauncher!.once("error", reject);
      });

      const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
      const response = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId: "adopt-owner-mismatch",
          sessionId: "adopt-owner-mismatch-session",
          projectRoot,
          pid: unrelatedLauncher.pid,
          port: runtimePort,
          listenerBindingDigest: "a".repeat(64),
          expectedListenerIdentityDigest: "b".repeat(64),
        }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: "Runtime listener ownership could not be verified.",
      });
    } finally {
      if (runtime?.leaderPid) {
        try { process.kill(-runtime.leaderPid, "SIGKILL"); } catch {}
      }
      if (runtime?.descendantPid) {
        try { process.kill(runtime.descendantPid, "SIGKILL"); } catch {}
      }
      if (unrelatedLauncher?.pid) {
        try { process.kill(-unrelatedLauncher.pid, "SIGKILL"); } catch {}
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it.skipIf(process.platform !== "linux")(
    "kills a surviving descendant after the process-group leader exits on SIGTERM",
    async () => {
      const supervisorPort = await freePort();
      const runtimePort = await freeManagedRuntimePort();
      const supervisor = startSupervisor(supervisorPort);
      const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-stop-"));
      let leaderPid: number | undefined;
      let descendantPid: number | undefined;

      try {
        await waitForHealth(supervisor, supervisorPort);
        const runtime = await startOrphaningRuntimeGroup(projectRoot, runtimePort, "stop-test");
        leaderPid = runtime.leaderPid;
        descendantPid = runtime.descendantPid;
        const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
        const adoptionProof = await runtimeAdoptionProof(leaderPid, runtimePort);

        const adoptResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            sessionId: "group-stop-session",
            projectRoot,
            pid: leaderPid,
            port: runtimePort,
            ...adoptionProof,
          }),
        });
        expect(adoptResponse.status).toBe(200);
        await adoptResponse.json();

        let stopResponseCompleted = false;
        const stopRequest = fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            sessionId: "group-stop-session",
          }),
        }).then((response) => {
          stopResponseCompleted = true;
          return response;
        });
        expect(await waitForProcessExit(leaderPid!, 1_000)).toBe(true);
        expect(await isProcessRunning(descendantPid)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(stopResponseCompleted).toBe(false);

        const observationResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/observe-start`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId: "group-stop-test" }),
        });
        expect(observationResponse.status).toBe(200);
        await expect(observationResponse.json()).resolves.toMatchObject({ status: "unknown" });

        const stopResponse = await stopRequest;
        expect(stopResponse.status).toBe(200);
        await expect(stopResponse.json()).resolves.toMatchObject({ status: "stopped", pid: null });
        expect(await waitForProcessExit(descendantPid, 1_000)).toBe(true);
        expect(isProcessGroupAlive(leaderPid!)).toBe(false);
      } finally {
        if (leaderPid) {
          try {
            process.kill(-leaderPid, "SIGKILL");
          } catch {
            // The isolated test group is already gone.
          }
        }
        if (descendantPid) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // The isolated test descendant is already gone.
          }
        }
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "linux")(
    "cleans an adopted process group before the supervisor exits",
    async () => {
      const supervisorPort = await freePort();
      const runtimePort = await freeManagedRuntimePort();
      const supervisor = startSupervisor(supervisorPort);
      const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-shutdown-"));
      let leaderPid: number | undefined;
      let descendantPid: number | undefined;

      try {
        await waitForHealth(supervisor, supervisorPort);
        const runtime = await startOrphaningRuntimeGroup(projectRoot, runtimePort, "shutdown-test");
        leaderPid = runtime.leaderPid;
        descendantPid = runtime.descendantPid;
        const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
        const adoptionProof = await runtimeAdoptionProof(leaderPid, runtimePort);

        const adoptResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: "group-shutdown-test",
            sessionId: "group-shutdown-session",
            projectRoot,
            pid: leaderPid,
            port: runtimePort,
            ...adoptionProof,
          }),
        });
        expect(adoptResponse.status).toBe(200);
        await adoptResponse.json();

        const supervisorExited = once(supervisor, "exit");
        supervisor.kill("SIGTERM");
        const [exitCode, exitSignal] = await supervisorExited;
        expect(exitCode).toBe(0);
        expect(exitSignal).toBeNull();
        expect(await waitForProcessExit(descendantPid, 1_000)).toBe(true);
        expect(isProcessGroupAlive(leaderPid)).toBe(false);
      } finally {
        if (leaderPid) {
          try {
            process.kill(-leaderPid, "SIGKILL");
          } catch {
            // The isolated test group is already gone.
          }
        }
        if (descendantPid) {
          try {
            process.kill(descendantPid, "SIGKILL");
          } catch {
            // The isolated test descendant is already gone.
          }
        }
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
    10_000,
  );
});
