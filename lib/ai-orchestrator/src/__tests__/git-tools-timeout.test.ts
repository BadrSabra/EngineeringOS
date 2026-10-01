import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeGitTool } from "../tools/git-tools.js";

describe("Git tool subprocess timeout", () => {
  it("terminates a hung Git subprocess at the server-owned timeout", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-tool-timeout-"));
    const binPath = path.join(root, "bin");
    const markerPath = path.join(root, "started-pid");
    const fakeGitPath = path.join(binPath, "git");
    await fs.mkdir(binPath);
    await fs.writeFile(
      fakeGitPath,
      `#!/bin/sh\nprintf '%s' "$$" > "${markerPath}"\nexec sleep 30\n`,
    );
    await fs.chmod(fakeGitPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binPath}${path.delimiter}${previousPath ?? ""}`;
    const startedAt = Date.now();
    try {
      const result = await executeGitTool("git_status", {}, root);
      const elapsedMs = Date.now() - startedAt;
      const childPid = Number(await fs.readFile(markerPath, "utf8"));

      expect(result).toContain("[git error]");
      expect(elapsedMs).toBeGreaterThanOrEqual(9_000);
      expect(elapsedMs).toBeLessThan(20_000);
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 25_000);
});