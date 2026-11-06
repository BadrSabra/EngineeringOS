import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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

function startSupervisor(port: number, extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      SESSION_SECRET: testSecret,
      WORKSPACE_RUNTIME_SUPERVISOR_PORT: String(port),
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

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !await isProcessRunning(pid);
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

  it.skipIf(process.platform !== "linux")(
    "kills a surviving descendant after the process-group leader exits on SIGTERM",
    async () => {
      const supervisorPort = await freePort();
      const runtimePort = await freePort();
      const supervisor = startSupervisor(supervisorPort);
      const projectRoot = await mkdtemp(path.join(tmpdir(), "workspace-runtime-stop-"));
      let leaderPid: number | undefined;
      let descendantPid: number | undefined;

      try {
        await waitForHealth(supervisor, supervisorPort);
        await writeFile(
          path.join(projectRoot, "package.json"),
          JSON.stringify({ scripts: { dev: "node dev.mjs" } }),
        );
        await writeFile(
          path.join(projectRoot, "leader.mjs"),
          [
            'import { spawn } from "node:child_process";',
            'import { writeFileSync } from "node:fs";',
            'import { createServer } from "node:net";',
            'const descendant = spawn(process.execPath, ["-e", \'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\'], { stdio: "ignore" });',
            'writeFileSync(process.env.TEST_DESCENDANT_PID_FILE, String(descendant.pid));',
            'const server = createServer((socket) => socket.end("ready"));',
            'server.listen(Number(process.env.TEST_RUNTIME_PORT), "127.0.0.1");',
            'process.once("SIGTERM", () => server.close(() => process.exit(0)));',
            'setInterval(() => {}, 1000);',
          ].join("\n"),
        );

        const token = deriveWorkspaceRuntimeSupervisorToken(testSecret);
        const descendantPidFile = path.join(projectRoot, "descendant.pid");
        const leader = spawn(process.execPath, [path.join(projectRoot, "leader.mjs")], {
          cwd: projectRoot,
          env: {
            ...process.env,
            TEST_RUNTIME_PORT: String(runtimePort),
            TEST_DESCENDANT_PID_FILE: descendantPidFile,
          },
          detached: true,
          stdio: "ignore",
        });
        children.push(leader);
        leaderPid = leader.pid ?? undefined;
        expect(leaderPid).toBeGreaterThan(1);

        const readyDeadline = Date.now() + 4_000;
        let ready = false;
        while (Date.now() < readyDeadline) {
          try {
            const response = await fetch(`http://127.0.0.1:${runtimePort}`);
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            // The isolated leader has not opened its listener yet.
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(ready).toBe(true);
        descendantPid = Number(await readFile(descendantPidFile, "utf8"));
        expect(descendantPid).toBeGreaterThan(1);
        expect(await readProcessGroupId(descendantPid)).toBe(leaderPid);
        expect(await isProcessRunning(descendantPid)).toBe(true);

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
          }),
        });
        expect(adoptResponse.status).toBe(200);
        await adoptResponse.json();

        const stopResponse = await fetch(`http://127.0.0.1:${supervisorPort}/runtime/stop`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: "group-stop-test",
            sessionId: "group-stop-session",
          }),
        });
        expect(stopResponse.status).toBe(200);
        await stopResponse.json();
        expect(await waitForProcessExit(descendantPid, 1_000)).toBe(true);
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
});
