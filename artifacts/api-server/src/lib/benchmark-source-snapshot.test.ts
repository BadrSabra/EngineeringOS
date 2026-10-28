import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createApprovedBenchmarkSourceSnapshot,
  findUnapprovedBenchmarkControlChanges,
  resolveApprovedBenchmarkSourceRevision,
} from "./benchmark-source-snapshot.js";
import { APPROVED_BENCHMARK_SOURCE_REVISION } from "./benchmark-source-policy.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

describe("approved benchmark source snapshot", () => {
  it("allows only the runner's explicit control-plane delta", () => {
    expect(findUnapprovedBenchmarkControlChanges([
      "artifacts/api-server/src/lib/benchmark-source-policy.ts",
      "artifacts/api-server/src/lib/benchmark-source-snapshot.ts",
      "artifacts/api-server/src/lib/benchmark-source-snapshot.test.ts",
      "artifacts/api-server/src/lib/run-code-agent-benchmark-airlock.ts",
    ])).toEqual([]);
    expect(findUnapprovedBenchmarkControlChanges([
      "lib/ai-orchestrator/src/index.ts",
      "pnpm-lock.yaml",
    ])).toEqual([
      "lib/ai-orchestrator/src/index.ts",
      "pnpm-lock.yaml",
    ]);
  });

  it("materializes the pinned commit under /tmp without changing HEAD or refs", async () => {
    const controlRoot = await git(process.cwd(), "rev-parse", "--show-toplevel");
    const headBefore = await git(controlRoot, "rev-parse", "HEAD");
    const refsBefore = await git(controlRoot, "show-ref");

    await expect(resolveApprovedBenchmarkSourceRevision(controlRoot))
      .resolves.toBe(APPROVED_BENCHMARK_SOURCE_REVISION);

    const snapshot = await createApprovedBenchmarkSourceSnapshot(
      controlRoot,
      APPROVED_BENCHMARK_SOURCE_REVISION,
    );
    try {
      const temporaryBase = await fs.realpath("/tmp");
      const realSnapshotRoot = await fs.realpath(snapshot.rootPath);
      const relativeRoot = path.relative(temporaryBase, realSnapshotRoot);
      expect(relativeRoot).not.toBe("");
      expect(relativeRoot.startsWith("..")).toBe(false);
      expect(path.isAbsolute(relativeRoot)).toBe(false);
      expect(snapshot.sourceRevision).toBe(APPROVED_BENCHMARK_SOURCE_REVISION);

      const expected = await git(
        controlRoot,
        "show",
        `${APPROVED_BENCHMARK_SOURCE_REVISION}:lib/ai-orchestrator/package.json`,
      );
      const actual = await fs.readFile(
        path.join(realSnapshotRoot, "lib/ai-orchestrator/package.json"),
        "utf8",
      );
      expect(actual.trim()).toBe(expected);
      expect(await git(controlRoot, "rev-parse", "HEAD")).toBe(headBefore);
      expect(await git(controlRoot, "show-ref")).toBe(refsBefore);
    } finally {
      await snapshot.cleanup();
    }
  });
});
