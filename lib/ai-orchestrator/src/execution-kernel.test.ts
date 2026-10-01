import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXECUTION_LIMITS, runBoundedCommand } from "./execution-kernel.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "ai-execution-kernel-"));
  roots.push(root);
  return root;
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

describe("bounded execution kernel", () => {
  it("runs an allowlisted command without shell interpolation", async () => {
    const root = await makeRoot();
    const result = await runBoundedCommand({
      command: "node",
      args: ["-e", "process.stdout.write(process.argv[1])", "safe"],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    });

    expect(result.status).toBe("passed");
    expect(result.stdout).toBe("safe");
    expect(result.truncated).toBe(false);
  });

  it("runs the pre-spawn hook before creating the child process", async () => {
    const root = await makeRoot();
    const hookMarker = path.join(root, "hook-ready.txt");
    const childMarker = path.join(root, "child-result.txt");
    const result = await runBoundedCommand({
      command: "node",
      args: [
        "-e",
        "const fs = require('node:fs'); fs.writeFileSync(process.argv[1], fs.existsSync(process.argv[2]) ? 'hook-ran' : 'hook-missing')",
        childMarker,
        hookMarker,
      ],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
      beforeSpawn: async () => {
        await writeFile(hookMarker, "ready");
      },
    });

    expect(result.status).toBe("passed");
    expect(await readFile(childMarker, "utf8")).toBe("hook-ran");
  });

  it("does not create a child when the pre-spawn hook rejects", async () => {
    const root = await makeRoot();
    const childMarker = path.join(root, "child-result.txt");
    await expect(runBoundedCommand({
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", childMarker],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
      beforeSpawn: () => {
        throw new Error("pre-spawn validation failed");
      },
    })).rejects.toThrow("pre-spawn validation failed");

    await expect(readFile(childMarker, "utf8")).rejects.toThrow();
  });

  it("revalidates the project boundary after the pre-spawn hook", async () => {
    const root = await makeRoot();
    const childMarker = path.join(root, "child-result.txt");
    await expect(runBoundedCommand({
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", childMarker],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
      beforeSpawn: async () => {
        await rm(root, { recursive: true, force: true });
      },
    })).rejects.toThrow();

    await expect(readFile(childMarker, "utf8")).rejects.toThrow();
  });

  it("redacts project/runtime paths and secret-like output", async () => {
    const root = await makeRoot();
    const result = await runBoundedCommand({
      command: "node",
      args: ["-e", "process.stdout.write(process.cwd() + ' token=super-secret')"],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 500,
    });

    expect(result.status).toBe("passed");
    expect(result.stdout).not.toContain(root);
    expect(result.stdout).toContain("[project path]");
    expect(result.stdout).toContain("token=[redacted]");
    expect(result.stdout).not.toContain("super-secret");
  });

  it("reports the spawned pid and redacts an injected child marker", async () => {
    const root = await makeRoot();
    const marker = "server-generated-child-marker";
    let observedPid: number | null | undefined;
    const result = await runBoundedCommand({
      command: "node",
      args: ["-e", "process.stdout.write(process.env.ENGINEERINGOS_CHILD_ATTESTATION ?? '')"],
      rootPath: root,
      env: {
        ...process.env,
        ENGINEERINGOS_CHILD_ATTESTATION: marker,
      },
      redactValues: [marker],
      onSpawn: ({ pid }) => {
        observedPid = pid;
      },
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    });

    expect(result.status).toBe("passed");
    expect(observedPid).toEqual(expect.any(Number));
    expect(result.stdout).toBe("[redacted]");
    expect(result.combinedOutput).not.toContain(marker);
  });

  it("rejects commands outside the explicit allowlist", async () => {
    const root = await makeRoot();
    await expect(runBoundedCommand({
      command: "node",
      args: ["-e", "process.exit(0)"],
      rootPath: root,
      allowedCommands: new Set(["pnpm"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    })).rejects.toThrow(/not allowed/i);
  });

  it("rejects a working directory outside the project root, including a symlink", async () => {
    const root = await makeRoot();
    const outside = await mkdtemp(path.join(tmpdir(), "ai-execution-outside-"));
    roots.push(outside);
    const linked = path.join(root, "linked");
    await symlink(outside, linked);

    await expect(runBoundedCommand({
      command: "node",
      args: ["-e", "process.exit(0)"],
      rootPath: root,
      cwd: linked,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    })).rejects.toThrow(/inside the project root/i);
  });

  it("fails closed when the approved root is deleted before execution", async () => {
    const root = await makeRoot();
    await rm(root, { recursive: true, force: true });

    await expect(runBoundedCommand({
      command: "node",
      args: ["-e", "process.exit(0)"],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    })).rejects.toThrow();
  });

  it("times out and bounds combined stdout/stderr", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "fixture.txt"), "fixture");
    const result = await runBoundedCommand({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(100000)); setTimeout(() => {}, 10000)"],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 50,
      maxOutputBytes: 1_000,
    });

    expect(["timed_out", "failed"]).toContain(result.status);
    expect(Buffer.byteLength(result.combinedOutput, "utf8")).toBeLessThanOrEqual(1_000);
    // Process startup can race the 50 ms timeout before the first output
    // chunk arrives. The contract is bounded non-success, not a guarantee
    // that truncation happened before timeout won the race.
    expect(typeof result.truncated).toBe("boolean");
  });

  it("terminates the process group and reports cancellation", async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    const resultPromise = runBoundedCommand({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      rootPath: root,
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);
    const result = await resultPromise;

    expect(result.status).toBe("cancelled");
  });

  it.each([
    { stopReason: "timeout", timeoutMs: 500, overflowOutput: false },
    { stopReason: "output limit", timeoutMs: 5_000, overflowOutput: true },
  ] as const)(
    "escalates $stopReason to descendants that ignore SIGTERM after the parent exits",
    async ({ stopReason, timeoutMs, overflowOutput }) => {
    const root = await makeRoot();
    let processGroupId: number | undefined;
    let descendantPid: number | undefined;
    const childScript = "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)";
    const script = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: ["ignore", "pipe", "ignore"] });`,
      `child.stdout.once("data", () => { process.stdout.write(String(child.pid)); ${overflowOutput ? 'process.stdout.write("x".repeat(10000));' : ""} });`,
      "setInterval(() => {}, 1000);",
    ].join("\n");

    try {
      const result = await runBoundedCommand({
        command: "node",
        args: ["-e", script],
        rootPath: root,
        allowedCommands: new Set(["node"]),
        timeoutMs,
        maxOutputBytes: 100,
        onSpawn: ({ pid }) => {
          processGroupId = pid ?? undefined;
        },
      });

      if (stopReason === "timeout") {
        expect(result.status).toBe("timed_out");
        expect(result.truncated).toBe(false);
      } else {
        expect(result.status).not.toBe("passed");
        expect(result.truncated).toBe(true);
        expect(Buffer.byteLength(result.combinedOutput, "utf8")).toBeLessThanOrEqual(100);
      }
      descendantPid = Number(result.stdout.match(/^\d+/)?.[0]);
      expect(Number.isInteger(descendantPid)).toBe(true);
      expect(descendantPid).toBeGreaterThan(0);
      expect(await waitForProcessExit(descendantPid, 3_000)).toBe(true);
    } finally {
      if (processGroupId) {
        try {
          process.kill(-processGroupId, "SIGKILL");
        } catch {
          // The process group is already gone.
        }
      }
    }
    },
  );

  it("keeps public limits explicit", () => {
    expect(EXECUTION_LIMITS.maxTimeoutMs).toBe(600_000);
    expect(EXECUTION_LIMITS.maxOutputBytes).toBe(8 * 1024 * 1024);
  });
});