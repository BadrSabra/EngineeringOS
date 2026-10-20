import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalBareGitHubRequest } from "./local-bare-github-adapter.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Lifecycle Test",
      GIT_AUTHOR_EMAIL: "lifecycle@example.invalid",
      GIT_COMMITTER_NAME: "Lifecycle Test",
      GIT_COMMITTER_EMAIL: "lifecycle@example.invalid",
      ...env,
    },
    encoding: "utf8",
  });
}

async function createFixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "engineeringos-local-github-test-"));
  temporaryRoots.push(root);
  const source = path.join(root, "source");
  const remote = path.join(root, "remote.git");
  await execFileAsync("git", ["init", "--bare", "--initial-branch=main", remote]);
  await execFileAsync("git", ["init", "--initial-branch=main", source]);
  await writeFile(path.join(source, "README.md"), "base\n", "utf8");
  await git(source, ["add", "README.md"]);
  await git(source, ["commit", "-m", "Initial fixture"]);
  await git(source, ["remote", "add", "origin", remote]);
  await git(source, ["push", "origin", "main"]);
  return { source, remote };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("controlled local bare GitHub adapter", () => {
  it("backs the verified GitHub REST object flow with actual objects and a compare-and-set ref update", async () => {
    const { remote } = await createFixtureRepo();
    const request = await createLocalBareGitHubRequest({ bareRepoPath: remote });
    const refPath = "/repos/fixture/engineering-agent-lifecycle/git/ref/heads/main";
    const updateRefPath = "/repos/fixture/engineering-agent-lifecycle/git/refs/heads/main";
    const ref = await request(refPath);
    const baseCommit = (ref.object as { sha: string }).sha;
    const base = await request(`/repos/fixture/engineering-agent-lifecycle/git/commits/${baseCommit}`);
    const baseTree = (base.tree as { sha: string }).sha;

    const blob = await request("/repos/fixture/engineering-agent-lifecycle/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: Buffer.from("verified update\n").toString("base64"), encoding: "base64" }),
    });
    const tree = await request("/repos/fixture/engineering-agent-lifecycle/git/trees", {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [{ path: "README.md", mode: "100644", type: "blob", sha: blob.sha }],
      }),
    });
    const commit = await request("/repos/fixture/engineering-agent-lifecycle/git/commits", {
      method: "POST",
      body: JSON.stringify({
        message: "Apply verified lifecycle candidate",
        tree: tree.sha,
        parents: [baseCommit],
      }),
    });
    await request(updateRefPath, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    const actualHead = (await git(remote, ["rev-parse", "refs/heads/main"])).stdout.trim();
    const actualContent = (await execFileAsync("git", [
      "--git-dir", remote, "show", `${String(commit.sha)}:README.md`,
    ], { encoding: "utf8" })).stdout;
    expect(actualHead).toBe(commit.sha);
    expect(actualContent).toBe("verified update\n");
    await expect(request("/repos/another/repository/git/ref/heads/main")).rejects.toThrow(
      "outside its fixed repository",
    );
  });

  it("rejects a non-bare repository and any repository alias", async () => {
    const { source, remote } = await createFixtureRepo();
    await expect(createLocalBareGitHubRequest({
      bareRepoPath: source,
    })).rejects.toThrow("must use a bare repository");
    await expect(createLocalBareGitHubRequest({
      bareRepoPath: remote,
      owner: "someone-else",
    })).rejects.toThrow("fixed repository identity");
  });
});
