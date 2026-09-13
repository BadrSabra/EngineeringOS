import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceRuntimeManager } from "./workspace-runtime.js";
import { createInMemoryWorkspaceRuntimeStore } from "./workspace-runtime-store.js";

const managers: WorkspaceRuntimeManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
});

describe("WorkspaceRuntimeManager", () => {
  it("starts a server-owned dev profile and stops its process group", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-"));
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
        "console.log('runtime fixture ready');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const manager = new WorkspaceRuntimeManager();
    managers.push(manager);
    const started = await manager.start({
      projectId: "project-runtime-test",
      projectRoot: root,
      revision: "revision-1",
    });

    expect(started.status).toBe("running");
    expect(started.port).toBeGreaterThanOrEqual(3000);
    expect(started.port).toBeLessThanOrEqual(3099);
    expect(started.command).toBe("pnpm run dev");

    const stopped = await manager.stop("project-runtime-test");
    expect(stopped.status).toBe("stopped");
    expect(stopped.pid).toBeNull();
    await fs.rm(root, { recursive: true, force: true });
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "node server.mjs" } }),
    );
    await fs.writeFile(
      path.join(root, "server.mjs"),
      [
        "import http from 'node:http';",
        "const server = http.createServer((_req, res) => res.end('runtime-recovery-ok'));",
        "server.listen(Number(process.env.PORT), '127.0.0.1');",
        "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join("\n"),
    );

    const store = createInMemoryWorkspaceRuntimeStore();
    const firstWorker = new WorkspaceRuntimeManager({ store, workerId: "worker-a" });
    const secondWorker = new WorkspaceRuntimeManager({ store, workerId: "worker-b" });
    managers.push(firstWorker, secondWorker);
    const started = await firstWorker.start({
      projectId: "recoverable-project",
      projectRoot: root,
      revision: "revision-1",
    });
    expect(started.status).toBe("running");

    await firstWorker.shutdown({ preserveProcesses: true });
    await secondWorker.recover();
    const adopted = await secondWorker.get("recoverable-project");
    expect(adopted.status).toBe("running");
    expect(adopted.pid).toBe(started.pid);
    expect(adopted.port).toBe(started.port);

    const stopped = await secondWorker.stop("recoverable-project");
    expect(stopped.status).toBe("stopped");
    await fs.rm(root, { recursive: true, force: true });
  });
});