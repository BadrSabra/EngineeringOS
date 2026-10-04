import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { executeGitTool } from "../tools/git-tools.js";

describe("Git tool subprocess timeout", () => {
  it("runs real Git from the pinned project root and treats diff paths literally", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-tool-real-repo-"));
    const literalPath = "literal[1].txt";
    const unrelatedPath = "literal1.txt";
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Git Tool Test",
      GIT_AUTHOR_EMAIL: "git-tool-test@example.invalid",
      GIT_COMMITTER_NAME: "Git Tool Test",
      GIT_COMMITTER_EMAIL: "git-tool-test@example.invalid",
    };
    try {
      await fs.writeFile(path.join(root, literalPath), "before\n");
      await fs.writeFile(path.join(root, unrelatedPath), "before\n");
      execFileSync("git", ["init", "-q"], { cwd: root });
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root, env: gitEnv });
      await fs.writeFile(path.join(root, literalPath), "after-literal\n");
      await fs.writeFile(path.join(root, unrelatedPath), "after-unrelated\n");

      const status = await executeGitTool("git_status", {}, root);
      const diff = await executeGitTool("git_diff", { path: literalPath }, root);

      expect(status).toContain(` M ${literalPath}`);
      expect(status).toContain(` M ${unrelatedPath}`);
      expect(diff).toContain("after-literal");
      expect(diff).not.toContain("after-unrelated");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps Git bound to the opened project directory if its path is replaced", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "git-tool-root-pin-"));
    const root = path.join(base, "project");
    const movedRoot = path.join(base, "project-moved");
    const binPath = path.join(base, "bin");
    const fakeGitPath = path.join(binPath, "git");
    await fs.mkdir(root);
    await fs.mkdir(binPath);
    await fs.writeFile(
      fakeGitPath,
      `#!/bin/sh\nmv ${JSON.stringify(root)} ${JSON.stringify(movedRoot)}\n` +
      `mkdir ${JSON.stringify(root)}\ntouch ${JSON.stringify(path.join(root, "decoy.txt"))}\n` +
      `touch pinned-after-open.txt\n` +
      `if [ -f ${JSON.stringify(path.join(movedRoot, "pinned-after-open.txt"))} ]; then\n` +
      `  printf 'pinned-project-root'\n` +
      `else\n  printf 'project-root-was-replaced'\nfi\n`,
    );
    await fs.chmod(fakeGitPath, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binPath}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = await executeGitTool("git_status", {}, root);
      expect(result).toBe("pinned-project-root");
      expect(await fs.access(path.join(movedRoot, "pinned-after-open.txt"))).toBeUndefined();
      await expect(fs.access(path.join(root, "pinned-after-open.txt"))).rejects.toThrow();
      await expect(fs.access(path.join(root, "decoy.txt"))).resolves.toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it("does not expose outside file contents when a selected diff path is swapped to symlinks", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "git-tool-path-swap-"));
    const root = path.join(base, "project");
    const outside = path.join(base, "outside");
    const binPath = path.join(base, "bin");
    const target = path.join(root, "src", "victim.txt");
    const secret = path.join(outside, "secret.txt");
    const realGitPath = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "Git Tool Test",
      GIT_AUTHOR_EMAIL: "git-tool-test@example.invalid",
      GIT_COMMITTER_NAME: "Git Tool Test",
      GIT_COMMITTER_EMAIL: "git-tool-test@example.invalid",
    };
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(outside);
    await fs.mkdir(binPath);
    await fs.writeFile(target, "project baseline\n");
    await fs.writeFile(secret, "EXTERNAL_DIFF_SECRET\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root, env: gitEnv });

    const fakeGitPath = path.join(binPath, "git");
    const previousPath = process.env.PATH;
    const runWithPathSwap = async (scriptBody: string): Promise<string> => {
      await fs.writeFile(
        fakeGitPath,
        `#!/bin/sh\n${scriptBody}\nexec ${JSON.stringify(realGitPath)} "$@"\n`,
      );
      await fs.chmod(fakeGitPath, 0o755);
      process.env.PATH = `${binPath}${path.delimiter}${previousPath ?? ""}`;
      return executeGitTool("git_diff", { path: "src/victim.txt" }, root);
    };

    try {
      const fileSymlinkDiff = await runWithPathSwap(
        `rm -f ${JSON.stringify(target)}\nln -s ${JSON.stringify(secret)} ${JSON.stringify(target)}`,
      );
      expect(fileSymlinkDiff).not.toContain("EXTERNAL_DIFF_SECRET");

      await fs.rm(target, { force: true });
      await fs.writeFile(target, "project baseline\n");
      const parentSymlinkDiff = await runWithPathSwap(
        `rm -rf ${JSON.stringify(path.join(root, "src"))}\n` +
        `ln -s ${JSON.stringify(outside)} ${JSON.stringify(path.join(root, "src"))}`,
      );
      expect(parentSymlinkDiff).not.toContain("EXTERNAL_DIFF_SECRET");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(base, { recursive: true, force: true });
    }
  });

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