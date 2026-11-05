import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
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
});
