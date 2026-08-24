import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseGitHubRemote,
  pushLocalCommitToGitHub,
} from "./github-connector.js";

const execFileAsync = promisify(execFile);

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

describe("GitHub connector push", () => {
  it("parses only HTTPS github.com remotes", () => {
    expect(parseGitHubRemote("https://github.com/acme/flight-deck.git")).toEqual({
      owner: "acme",
      repo: "flight-deck",
    });
    expect(parseGitHubRemote("git@github.com:acme/flight-deck.git")).toBeUndefined();
    expect(parseGitHubRemote("https://example.com/acme/flight-deck.git")).toBeUndefined();
  });

  it("mirrors a verified local commit through GitHub git objects", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-github-"));
    try {
      await git(rootPath, ["init", "-q"]);
      await writeFile(path.join(rootPath, "README.md"), "before\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "initial",
      ]);
      const parentHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
      await writeFile(path.join(rootPath, "README.md"), "after\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "verified change",
      ]);
      const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();

      const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
      let blobCall = 0;
      const request = async (
        requestPath: string,
        init: { method?: string; body?: string } = {},
      ): Promise<Record<string, unknown>> => {
        const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : undefined;
        calls.push({ path: requestPath, method: init.method ?? "GET", body });
        if (requestPath.endsWith("/git/ref/heads/main")) {
          return { object: { sha: parentHash } };
        }
        if (requestPath.endsWith(`/git/commits/${parentHash}`)) {
          return { tree: { sha: "base-tree" } };
        }
        if (requestPath.endsWith("/git/blobs")) {
          blobCall++;
          return { sha: `blob-${blobCall}` };
        }
        if (requestPath.endsWith("/git/trees")) return { sha: "new-tree" };
        if (requestPath.endsWith("/git/commits")) return { sha: "remote-commit" };
        if (requestPath.endsWith("/git/refs/heads/main")) return {};
        throw new Error(`unexpected GitHub path: ${requestPath}`);
      };

      const result = await pushLocalCommitToGitHub({
        rootPath,
        remote: { owner: "acme", repo: "flight-deck" },
        branch: "main",
        commitHash,
        message: "verified change",
        request,
      });

      expect(result).toEqual({
        remoteCommitHash: "remote-commit",
        changedPaths: ["README.md"],
      });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "GET /repos/acme/flight-deck/git/ref/heads/main",
        `GET /repos/acme/flight-deck/git/commits/${parentHash}`,
        "POST /repos/acme/flight-deck/git/blobs",
        "POST /repos/acme/flight-deck/git/trees",
        "POST /repos/acme/flight-deck/git/commits",
        "PATCH /repos/acme/flight-deck/git/refs/heads/main",
      ]);
      expect(calls[2]?.body).toMatchObject({ encoding: "base64" });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails closed when the remote branch moved past the verified parent", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-github-drift-"));
    try {
      await git(rootPath, ["init", "-q"]);
      await writeFile(path.join(rootPath, "README.md"), "fixture\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "fixture",
      ]);
      await writeFile(path.join(rootPath, "README.md"), "fixture update\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "verified fixture",
      ]);
      const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
      await expect(pushLocalCommitToGitHub({
        rootPath,
        remote: { owner: "acme", repo: "flight-deck" },
        branch: "main",
        commitHash,
        message: "fixture",
        request: async () => ({ object: { sha: "different-remote" } }),
      })).rejects.toMatchObject({ code: "GITHUB_PUSH_REMOTE_DRIFT" });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});