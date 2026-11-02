import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureCleanGitSourceCommitSha } from "./delivery-workspace.js";
import {
  createLocalReviewBranchWorkspace,
  LocalReviewBranchError,
} from "./local-review-branch.js";

function git(rootPath: string, ...args: string[]): string {
  return execFileSync("git", ["-C", rootPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function createSourceFixture() {
  const rootPath = await mkdtemp(path.join(tmpdir(), "eos-local-review-source-"));
  const projectRootPath = path.join(rootPath, "packages", "app");
  await mkdir(projectRootPath, { recursive: true });
  git(rootPath, "init", "--quiet");
  git(rootPath, "config", "user.name", "Local Review Test");
  git(rootPath, "config", "user.email", "local-review@example.invalid");
  await writeFile(path.join(projectRootPath, "source.ts"), "export const value = 1;\n");
  git(rootPath, "add", "--", "packages/app/source.ts");
  git(rootPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "-m", "source fixture");
  const sourceCommitSha = git(rootPath, "rev-parse", "--verify", "HEAD^{commit}").trim();
  return { rootPath, projectRootPath, sourceCommitSha };
}

describe("isolated local review branches", () => {
  it("creates an uncommitted review worktree from the captured source SHA, never the live checkout", async () => {
    const fixture = await createSourceFixture();
    const storageRoot = path.join(tmpdir(), `eos-local-review-worktrees-${randomUUID()}`);
    const projectId = randomUUID();
    const proposalId = randomUUID();
    try {
      const captured = await captureCleanGitSourceCommitSha(fixture.projectRootPath);
      expect(captured).toEqual({
        commitSha: fixture.sourceCommitSha,
        projectRootRelativePath: "packages/app",
      });
      const input = {
        projectId,
        proposalId,
        repositoryRootPath: fixture.projectRootPath,
        projectRootRelativePath: captured!.projectRootRelativePath,
        sourceCommitSha: captured!.commitSha,
        changes: [{
          path: "source.ts",
          originalContent: "export const value = 1;\n",
          newContent: "export const value = 2;\n",
        }],
        worktreesRoot: storageRoot,
      };

      const result = await createLocalReviewBranchWorkspace(input);
      expect(result).toMatchObject({
        sourceCommitSha: fixture.sourceCommitSha,
        reused: false,
      });
      expect(git(fixture.rootPath, "rev-parse", "HEAD").trim()).toBe(fixture.sourceCommitSha);
      await expect(readFile(path.join(fixture.projectRootPath, "source.ts"), "utf8"))
        .resolves.toBe("export const value = 1;\n");
      await expect(readFile(path.join(result.projectRootPath, "source.ts"), "utf8"))
        .resolves.toBe("export const value = 2;\n");
      expect(git(result.worktreePath, "rev-parse", "HEAD").trim()).toBe(fixture.sourceCommitSha);
      expect(git(result.worktreePath, "branch", "--show-current").trim()).toBe(result.branchName);
      expect(git(result.worktreePath, "status", "--porcelain").trim()).not.toBe("");

      await expect(createLocalReviewBranchWorkspace(input)).resolves.toMatchObject({
        branchName: result.branchName,
        reused: true,
      });
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects a stale base before creating a branch", async () => {
    const fixture = await createSourceFixture();
    const storageRoot = path.join(tmpdir(), `eos-local-review-stale-${randomUUID()}`);
    try {
      await expect(createLocalReviewBranchWorkspace({
        projectId: randomUUID(),
        proposalId: randomUUID(),
        repositoryRootPath: fixture.projectRootPath,
        projectRootRelativePath: "packages/app",
        sourceCommitSha: fixture.sourceCommitSha,
        changes: [{
          path: "source.ts",
          originalContent: "stale source\n",
          newContent: "candidate\n",
        }],
        worktreesRoot: storageRoot,
      })).rejects.toMatchObject<Partial<LocalReviewBranchError>>({
        code: "LOCAL_REVIEW_SOURCE_MISMATCH",
      });
      await expect(readFile(storageRoot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(git(fixture.rootPath, "worktree", "list", "--porcelain").match(/^worktree /gm))
        .toHaveLength(1);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe paths and tracked symlinks", async () => {
    const fixture = await createSourceFixture();
    const storageRoot = path.join(tmpdir(), `eos-local-review-path-${randomUUID()}`);
    try {
      await expect(createLocalReviewBranchWorkspace({
        projectId: randomUUID(),
        proposalId: randomUUID(),
        repositoryRootPath: fixture.projectRootPath,
        projectRootRelativePath: "packages/app",
        sourceCommitSha: fixture.sourceCommitSha,
        changes: [{
          path: "../escape.txt",
          originalContent: null,
          newContent: "no\n",
        }],
        worktreesRoot: storageRoot,
      })).rejects.toMatchObject({ code: "LOCAL_REVIEW_CHANGESET_INVALID" });

      await symlink("source.ts", path.join(fixture.projectRootPath, "link.ts"));
      git(fixture.rootPath, "add", "--", "packages/app/link.ts");
      git(fixture.rootPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "--quiet", "-m", "symlink fixture");
      const commit = git(fixture.rootPath, "rev-parse", "HEAD").trim();
      await expect(createLocalReviewBranchWorkspace({
        projectId: randomUUID(),
        proposalId: randomUUID(),
        repositoryRootPath: fixture.projectRootPath,
        projectRootRelativePath: "packages/app",
        sourceCommitSha: commit,
        changes: [{
          path: "link.ts",
          originalContent: "source.ts",
          newContent: "changed link\n",
        }],
        worktreesRoot: storageRoot,
      })).rejects.toMatchObject({ code: "LOCAL_REVIEW_SOURCE_INVALID" });
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("preserves a reviewer-edited branch instead of reapplying the proposal", async () => {
    const fixture = await createSourceFixture();
    const storageRoot = path.join(tmpdir(), `eos-local-review-edited-${randomUUID()}`);
    const input = {
      projectId: randomUUID(),
      proposalId: randomUUID(),
      repositoryRootPath: fixture.projectRootPath,
      projectRootRelativePath: "packages/app",
      sourceCommitSha: fixture.sourceCommitSha,
      changes: [{
        path: "source.ts",
        originalContent: "export const value = 1;\n",
        newContent: "export const value = 2;\n",
      }],
      worktreesRoot: storageRoot,
    };
    try {
      const result = await createLocalReviewBranchWorkspace(input);
      await writeFile(path.join(result.projectRootPath, "source.ts"), "reviewer edit\n");
      await expect(createLocalReviewBranchWorkspace(input))
        .rejects.toMatchObject({ code: "LOCAL_REVIEW_BRANCH_CHANGED" });
      await expect(readFile(path.join(result.projectRootPath, "source.ts"), "utf8"))
        .resolves.toBe("reviewer edit\n");
      expect(git(fixture.rootPath, "rev-parse", "HEAD").trim()).toBe(fixture.sourceCommitSha);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
