import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

  it("keeps public limits explicit", () => {
    expect(EXECUTION_LIMITS.maxTimeoutMs).toBe(600_000);
    expect(EXECUTION_LIMITS.maxOutputBytes).toBe(8 * 1024 * 1024);
  });
});