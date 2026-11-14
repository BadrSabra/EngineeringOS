import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeListenerProcess } from "./agent-state/runtime-listener-process.js";
import { createWorkspaceRuntimeSupervisorCommand } from "../../../../scripts/workspace-runtime-supervisor-protocol.mjs";

const nativeFetch = globalThis.fetch.bind(globalThis);
const supervisorSockets = new Map<number, { socketPath: string; privateKey: KeyObject }>();
const supervisorControlDirectories: string[] = [];
const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/workspace-runtime-supervisor.mjs",
);
const children: ChildProcess[] = [];

function fixtureStateVersion(projectId: string, sessionId: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify({ projectId, sessionId, fixture: "workspace-runtime-supervisor-test-v1" }))
    .digest("hex");
}

function signedFixtureRequest(
  socket: { socketPath: string; privateKey: KeyObject },
  pathname: string,
  body: string,
  replayCommand?: { body: string; encodedCommand: string; signature: string },
): Promise<{ status: number; body: string }> {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const action = pathname.endsWith("/start") ? "start"
    : pathname.endsWith("/adopt") ? "adopt"
      : pathname.endsWith("/stop") ? "stop"
        : pathname.endsWith("/observe-start") ? "observe-start"
          : null;
  if (!action) return Promise.resolve({ status: 404, body: JSON.stringify({ error: "not_found" }) });
  const projectId = String(parsed.projectId ?? "");
  const sessionId = action === "observe-start" ? null : String(parsed.sessionId ?? "");
  const pid = typeof parsed.pid === "number" ? parsed.pid : null;
  const processIdentity = action === "adopt"
    ? {
      pid,
      port: typeof parsed.port === "number" ? parsed.port : null,
      listenerIdentityDigest: typeof parsed.expectedListenerIdentityDigest === "string"
        ? parsed.expectedListenerIdentityDigest
        : "",
    }
    : action === "stop" ? { pid } : null;
  const command = replayCommand ?? createWorkspaceRuntimeSupervisorCommand({
    privateKey: socket.privateKey,
    action,
    projectId,
    sessionId,
    stateVersion: fixtureStateVersion(projectId, sessionId),
    processIdentity,
    body,
  });
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(command.body, "utf8");
    const request = http.request({
      socketPath: socket.socketPath,
      path: pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(payload.byteLength),
        "x-eos-command": command.encodedCommand,
        "x-eos-signature": command.signature,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode ?? 502,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    request.end(payload);
  });
}

async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const socket = supervisorSockets.get(Number(target.port));
  if (!socket) return nativeFetch(input, init);
  if (init?.method === undefined || init.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }
  const body = String(init.body ?? "{}");
  let result: { status: number; body: string };
  if (!(new Headers(init.headers)).has("x-test-authorize")) {
    result = await new Promise((resolve, reject) => {
      const payload = Buffer.from(body, "utf8");
      const request = http.request({
        socketPath: socket.socketPath,
        path: target.pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(payload.byteLength) },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.once("error", reject);
        response.once("end", () => resolve({
          status: response.statusCode ?? 502,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.once("error", reject);
      request.end(payload);
    });
  } else {
    result = await signedFixtureRequest(socket, target.pathname, body);
  }
  return new Response(result.body, { status: result.status, headers: { "content-type": "application/json" } });
}

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
  const directory = mkdtempSync(path.join(tmpdir(), "workspace-runtime-supervisor-uds-test-"));
  chmodSync(directory, 0o2710);
  const socketPath = path.join(directory, "control.sock");
  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  supervisorSockets.set(port, { socketPath, privateKey: pair.privateKey });
  supervisorControlDirectories.push(directory);
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      NODE_ENV: "test",
      WORKSPACE_RUNTIME_SUPERVISOR_TEST_MODE: "1",
      WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH: socketPath,
      WORKSPACE_RUNTIME_SUPERVISOR_API_GID: String(process.getgid?.() ?? 1000),
      WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID: String(process.getuid?.() || 65534),
      WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID: String(process.getgid?.() || 65534),
      WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64: publicKeyDer.toString("base64"),
      WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON: JSON.stringify([tmpdir()]),
      ...extraEnv,
    },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

async function waitForHealth(child: ChildProcess, port: number): Promise<void> {
  const socketPath = supervisorSockets.get(port)?.socketPath;
  if (!socketPath) throw new Error("Workspace runtime supervisor socket fixture is missing.");
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Supervisor exited with code ${child.exitCode}.`);
    try {
      if ((await lstat(socketPath)).isSocket()) return;
    } catch {
      // The supervisor has not created its Unix socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Workspace runtime supervisor Unix socket did not become ready.");
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
      'process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });',
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
  for (const directory of supervisorControlDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  supervisorSockets.clear();
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

    
    const authorized = await fetch(`http://127.0.0.1:${port}/runtime/observe-start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-authorize": "signed-fixture",
      },
      body: JSON.stringify({
        projectId: "test-project",
        ownerProjectId: "test-project",
        projectRoot: tmpdir(),
      }),
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      projectId: "test-project",
      ownerProjectId: "test-project",
      projectRoot: tmpdir(),
      inventoryComplete: true,
    });
  });

  it("rejects a replayed signed supervisor command", async () => {
    const port = await freePort();
    const child = startSupervisor(port);
    try {
      await waitForHealth(child, port);
      const socket = supervisorSockets.get(port);
      if (!socket) throw new Error("Supervisor signing fixture is unavailable.");
      const projectId = "replayed-supervisor-command";
      const body = JSON.stringify({
        projectId,
        ownerProjectId: projectId,
        projectRoot: tmpdir(),
        sessionId: null,
      });
      const command = createWorkspaceRuntimeSupervisorCommand({
        privateKey: socket.privateKey,
        action: "observe-start",
        projectId,
        sessionId: null,
        stateVersion: fixtureStateVersion(projectId, null),
        processIdentity: null,
        body,
      });
      const first = await signedFixtureRequest(socket, "/runtime/observe-start", body, command);
      expect(first.status).toBe(200);
      const replay = await signedFixtureRequest(socket, "/runtime/observe-start", body, command);
      expect(replay.status).toBe(409);
      expect(JSON.parse(replay.body)).toMatchObject({ error: "Supervisor command was already consumed." });
    } finally {
      await stopChild(child);
    }
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
        ].join("\n"),
      );
      await waitForHealth(supervisor, supervisorPort);
      
      const response = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId: "outside-workspace-project",
          ownerProjectId: "outside-workspace-project",
          sessionId: "outside-workspace-session",
          projectRoot: outsideRoot,
          profile: "dev",
        }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "The registered project root is unavailable or outside the configured workspace.",
      });

      const outsideRootObservation = await fetch(
        `http://127.0.0.1:${supervisorPort}/runtime/observe-start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "outside-workspace-project",
            ownerProjectId: "outside-workspace-project",
            projectRoot: outsideRoot,
          }),
        },
      );
      expect(outsideRootObservation.status).toBe(400);

      await expect(
        readFile(path.join(outsideRoot, "started.txt"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(allowedRoot, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it("binds every supervisor command to the tracked project owner and workspace root", async () => {
    const supervisorPort = await freePort();
    const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-bound-owner-"));
    const differentRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-bound-root-"));
    const supervisor = startSupervisor(supervisorPort);
    const projectId = "bound-runtime-project";
    const ownerProjectId = "bound-runtime-owner";
    const sessionId = "bound-runtime-session";
    let session: { projectId: string; ownerProjectId: string; projectRoot: string; sessionId: string; status: string; port: number; pid: number | null } | undefined;

    try {
      await writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ type: "module", scripts: { dev: "node server.mjs" } }),
      );
      await writeFile(
        path.join(projectRoot, "server.mjs"),
        [
          'import http from "node:http";',
          'const server = http.createServer((_req, res) => res.end("owner-root-bound"));',
          'server.listen(Number(process.env.PORT), "127.0.0.1");',
          'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
        ].join("\n"),
      );
      await waitForHealth(supervisor, supervisorPort);

      const started = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId,
          ownerProjectId,
          sessionId,
          projectRoot,
          profile: "dev",
        }),
      });
      expect(started.status).toBe(200);
      session = await started.json() as typeof session;
      expect(session).toMatchObject({
        projectId,
        ownerProjectId,
        projectRoot,
        sessionId,
        status: "running",
      });

      const wrongOwnerObservation = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/observe-start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({ projectId, ownerProjectId: "different-owner", projectRoot }),
      });
      expect(wrongOwnerObservation.status).toBe(409);

      const wrongRootObservation = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/observe-start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({ projectId, ownerProjectId, projectRoot: differentRoot }),
      });
      expect(wrongRootObservation.status).toBe(409);

      const wrongOwnerStop = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId,
          ownerProjectId: "different-owner",
          sessionId,
          projectRoot,
          pid: session?.pid,
        }),
      });
      expect(wrongOwnerStop.status).toBe(409);

      const wrongRootStop = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId,
          ownerProjectId,
          sessionId,
          projectRoot: differentRoot,
          pid: session?.pid,
        }),
      });
      expect(wrongRootStop.status).toBe(409);
      await expect((await fetch(`http://127.0.0.1:${session!.port}`)).text()).resolves.toBe("owner-root-bound");

      const trackedSession = session;
      if (!trackedSession) throw new Error("Supervisor start did not return a tracked session.");

      const stopped = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId,
          ownerProjectId,
          sessionId,
          projectRoot,
          pid: trackedSession.pid,
        }),
      });
      expect(stopped.status).toBe(200);
      await expect(stopped.json()).resolves.toMatchObject({
        projectId,
        ownerProjectId,
        projectRoot,
        sessionId,
        status: "stopped",
      });
      session = undefined;
    } finally {
      if (session?.pid) {
        try { process.kill(-session.pid, "SIGKILL"); } catch {}
      }
      await stopChild(supervisor);
      await rm(projectRoot, { recursive: true, force: true });
      await rm(differentRoot, { recursive: true, force: true });
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
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({ projectId, ownerProjectId: projectId, sessionId, projectRoot, profile: "dev" }),
      });
      expect(response.status).toBe(200);
      sessionStarted = true;
      await expect(response.json()).resolves.toMatchObject({
        projectId,
        ownerProjectId: projectId,
        projectRoot,
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({ projectId, ownerProjectId: projectId, sessionId, projectRoot }),
        }).catch(() => undefined);
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a protected Unix socket is not configured", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "/tmp",
        
        WORKSPACE_RUNTIME_SUPERVISOR_PORT: "8098",
        WORKSPACE_RUNTIME_SUPERVISOR_HOST: "0.0.0.0",
      },
      timeout: 3_000,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("requires an absolute Unix socket path");
  });

  it("does not signal a PID when the session is not supervisor-owned", async () => {
    const port = await freePort();
    const child = startSupervisor(port);
    await waitForHealth(child, port);
    

    const response = await fetch(`http://127.0.0.1:${port}/runtime/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-authorize": "signed-fixture",
      },
      body: JSON.stringify({
        projectId: "test-project",
        ownerProjectId: "test-project",
        sessionId: "test-session",
        projectRoot: tmpdir(),
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
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({ projectId, ownerProjectId: projectId, sessionId, projectRoot, profile: "dev" }),
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({ projectId, ownerProjectId: projectId, projectRoot }),
        },
      );
      expect(observationResponse.status).toBe(200);
      const observation = await observationResponse.json() as {
        projectId: string;
        status: string;
        inventoryComplete: boolean;
        unknownListenerPorts: number[];
        session: {
          projectId: string;
          ownerProjectId: string;
          projectRoot: string;
          sessionId: string;
          status: string;
        };
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({ projectId, ownerProjectId: projectId, sessionId, projectRoot }),
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({ projectId, ownerProjectId: projectId, projectRoot: tmpdir() }),
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "concurrent-start-project",
            ownerProjectId: "concurrent-start-project",
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
              "x-test-authorize": "signed-fixture",
            },
            body: JSON.stringify({
              projectId: session.projectId,
              ownerProjectId: "concurrent-start-project",
              sessionId: session.sessionId,
              projectRoot,
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

      
      const response = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-authorize": "signed-fixture",
        },
        body: JSON.stringify({
          projectId: "adopt-owner-mismatch",
          ownerProjectId: "adopt-owner-mismatch",
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
        
        const adoptionProof = await runtimeAdoptionProof(leaderPid, runtimePort);

        const adoptResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            ownerProjectId: "group-stop-test",
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
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            ownerProjectId: "group-stop-test",
            sessionId: "group-stop-session",
            projectRoot,
            pid: leaderPid,
          }),
        }).then((response) => {
          stopResponseCompleted = true;
          return response;
        });
        expect(await waitForProcessExit(leaderPid!, 1_500)).toBe(true);
        expect(await isProcessRunning(descendantPid)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(stopResponseCompleted).toBe(false);

        const observationResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/observe-start`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            ownerProjectId: "group-stop-test",
            projectRoot,
          }),
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
        
        const adoptionProof = await runtimeAdoptionProof(leaderPid, runtimePort);

        const adoptResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/adopt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-authorize": "signed-fixture",
          },
          body: JSON.stringify({
            projectId: "group-shutdown-test",
            ownerProjectId: "group-shutdown-test",
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
