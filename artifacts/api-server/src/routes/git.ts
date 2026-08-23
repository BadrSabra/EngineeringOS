/**
 * Git integration routes — commit, push, status, log, config.
 *
 * All mutating operations (commit, push) require project write access.
 * Read-only operations (status, log, config GET) require project read access.
 *
 * GitHub token is stored in ai_provider_credentials with provider = 'github',
 * encrypted with the same AES-256-GCM scheme used for Groq keys.
 * The token is never returned to the client — only a last4 + configured flag.
 *
 * git push injects the token into the HTTPS URL at call time and never logs
 * the authenticated URL.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { stat as fsStat, readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@workspace/db";
import {
  projectsTable,
  aiProviderCredentialsTable,
  aiChangeProposalsTable,
  eventsTable,
  scanJobsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { runScanJob } from "../lib/scan-runner.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import { requireProjectAccess, requireProjectWriteAccess } from "../middlewares/requireProjectAccess.js";
import { encryptApiKey, decryptApiKey } from "../lib/credentials-crypto.js";
import { recordAudit } from "../lib/audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import {
  GitHubConnectorError,
  parseGitHubRemote,
  pushLocalCommitToGitHub,
} from "../lib/github-connector.js";

const router = Router();
const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 2 * 1024 * 1024; // 2 MB
const TEST_FIXTURE_REMOTE = "https://fixture.local/engineeringos.git";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runGit(
  args: string[],
  cwd: string,
  opts?: { timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: opts?.timeout ?? GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, ...(opts?.env ?? {}) },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Verify that a project's working-tree directory still exists on disk.
 * Temporary checkouts under /tmp are cleaned up on server restart; when
 * that happens git returns a raw "cannot change to '/tmp/eos-git-...'"
 * fatal that confuses users. This check surfaces a clear recovery hint.
 */
async function assertRootPathExists(rootPath: string): Promise<void> {
  try {
    const s = await fsStat(rootPath);
    if (!s.isDirectory()) throw new Error("not_a_directory");
  } catch {
    throw Object.assign(new Error("rootpath_missing"), { rootPath });
  }
}

/** Redact any embedded token from a git error message before returning to client. */
function redact(s: string): string {
  return s.replace(/x-access-token:[^@]+@/g, "x-access-token:[REDACTED]@");
}

async function getGithubToken(userId: string): Promise<string | null> {
  const rows = await db.select().from(aiProviderCredentialsTable).where(and(
    eq(aiProviderCredentialsTable.ownerId, userId),
    eq(aiProviderCredentialsTable.provider, "github"),
  )).limit(1);
  if (!rows[0]) return null;
  try { return decryptApiKey(rows[0].encryptedApiKey); } catch { return null; }
}

function buildAuthUrl(remoteUrl: string, token: string): string {
  return remoteUrl.replace(/^https?:\/\//, `https://x-access-token:${token}@`);
}

async function findOperationEvent(
  projectId: string,
  type: string,
  correlationId: string,
): Promise<Record<string, unknown> | undefined> {
  const [event] = await db
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, projectId),
      eq(eventsTable.type, type),
      eq(eventsTable.correlationId, correlationId),
    ))
    .orderBy(desc(eventsTable.timestamp))
    .limit(1);
  return event?.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : undefined;
}

// ── GitHub token management ───────────────────────────────────────────────────

/** GET /api/ai/github-token — check if a GitHub PAT is saved */
router.get("/ai/github-token", async (req, res) => {
  const rows = await db
    .select({ last4: aiProviderCredentialsTable.last4, updatedAt: aiProviderCredentialsTable.updatedAt })
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "github"),
      ),
    )
    .limit(1);
  if (!rows[0]) return res.json({ configured: false });
  return res.json({ configured: true, last4: rows[0].last4, updatedAt: rows[0].updatedAt });
});

/** PUT /api/ai/github-token — save a GitHub PAT */
router.put("/ai/github-token", async (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token?.trim()) return res.status(400).json({ error: "token is required" });

  const encryptedApiKey = encryptApiKey(token.trim());
  const last4 = token.trim().slice(-4);
  const now = new Date();

  await db
    .insert(aiProviderCredentialsTable)
    .values({
      id: randomUUID(),
      ownerId: req.userId,
      provider: "github",
      encryptedApiKey,
      last4,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: { encryptedApiKey, last4, updatedAt: now },
    });

  return res.json({ configured: true, last4, updatedAt: now });
});

/** DELETE /api/ai/github-token — remove the saved GitHub PAT */
router.delete("/ai/github-token", async (req, res) => {
  await db
    .delete(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, req.userId),
        eq(aiProviderCredentialsTable.provider, "github"),
      ),
    );
  return res.json({ configured: false });
});

// ── Git config ────────────────────────────────────────────────────────────────

/** GET /api/projects/:projectId/git/config */
router.get("/projects/:projectId/git/config", requireProjectAccess, async (req, res) => {
  const project = req.project!;
  return res.json({
    remoteUrl: project.gitRemoteUrl ?? null,
    branch: project.gitDefaultBranch ?? "main",
  });
});

/** PATCH /api/projects/:projectId/git/config */
router.patch("/projects/:projectId/git/config", requireProjectWriteAccess, async (req, res) => {
  const { remoteUrl, branch } = req.body as { remoteUrl?: string; branch?: string };
  const project = req.project!;

  const updates: Partial<typeof projectsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (remoteUrl !== undefined) updates.gitRemoteUrl = remoteUrl.trim() || null;
  if (branch !== undefined) updates.gitDefaultBranch = branch.trim() || "main";
  if (updates.gitRemoteUrl && !parseGitHubRemote(updates.gitRemoteUrl)) {
    return res.status(400).json({
      error: "Remote URL must be a credential-free HTTPS github.com repository URL.",
      code: "UNSAFE_REMOTE_URL",
    });
  }
  if (updates.gitDefaultBranch && !/^[A-Za-z0-9._/-]{1,200}$/.test(updates.gitDefaultBranch)) {
    return res.status(400).json({ error: "Invalid branch name.", code: "INVALID_BRANCH" });
  }

  await db.update(projectsTable).set(updates).where(eq(projectsTable.id, project.id));

  return res.json({
    remoteUrl: updates.gitRemoteUrl ?? project.gitRemoteUrl,
    branch: updates.gitDefaultBranch ?? project.gitDefaultBranch ?? "main",
  });
});

// ── Git read operations ───────────────────────────────────────────────────────

/** GET /api/projects/:projectId/git/status */
router.get("/projects/:projectId/git/status", requireProjectAccess, async (req, res) => {
  const { rootPath } = req.project!;
  try {
    await assertRootPathExists(rootPath);
    const { stdout } = await runGit(["status", "--short", "-u"], rootPath);
    const files = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => ({
        status: line.slice(0, 2).trim(),
        path: line.slice(3),
      }));
    return res.json({ clean: files.length === 0, files });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const raw = e.stderr?.trim() || e.message || "git status failed";
    // "not a git repository" is an expected state, not a server bug
    if ((err as { message?: string }).message === "rootpath_missing") {
      return res.status(409).json({
        error: "rootpath_missing",
        hint: "The project's working directory no longer exists (temporary checkouts are cleaned up on server restart). Re-trigger a scan to restore it.",
      });
    }
    if (raw.includes("not a git repository")) {
      return res.status(400).json({
        error: "not_a_git_repo",
        hint: "This project directory is not a git repository. Run `git init` inside it or link an existing repo.",
      });
    }
    logger.error({ err, projectId: req.project!.id, operation: "status" }, "git status failed");
    return res.status(502).json({ error: "git_operation_failed", code: "GIT_STATUS_FAILED", hint: "Git status could not be completed. Check the project repository and try again." });
  }
});

/** GET /api/projects/:projectId/git/log */
router.get("/projects/:projectId/git/log", requireProjectAccess, async (req, res) => {
  const { rootPath } = req.project!;
  try {
    await assertRootPathExists(rootPath);
    const { stdout } = await runGit(
      ["log", "--format=%H\x1f%h\x1f%ad\x1f%an\x1f%s", "--date=short", "-20"],
      rootPath,
    );
    const commits = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, author, subject] = line.split("\x1f");
        return { hash, shortHash, date, author, subject };
      });
    return res.json({ commits });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const raw = e.stderr?.trim() || e.message || "git log failed";
    if ((err as { message?: string }).message === "rootpath_missing") {
      return res.status(409).json({
        error: "rootpath_missing",
        hint: "The project's working directory no longer exists. Re-trigger a scan to restore it.",
      });
    }
    if (raw.includes("not a git repository")) {
      return res.status(400).json({
        error: "not_a_git_repo",
        hint: "This project directory is not a git repository.",
      });
    }
    logger.error({ err, projectId: req.project!.id, operation: "log" }, "git log failed");
    return res.status(502).json({ error: "git_operation_failed", code: "GIT_LOG_FAILED", hint: "Git history could not be read. Check the project repository and try again." });
  }
});

// ── Git write operations ──────────────────────────────────────────────────────

/** POST /api/projects/:projectId/git/commit — stage selected or all changes and commit */
router.post("/projects/:projectId/git/commit", requireProjectWriteAccess, async (req, res) => {
  const body = req.body as {
    message?: unknown;
    proposalId?: unknown;
    operationId?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : undefined;
  const operationId = typeof body.operationId === "string" ? body.operationId : undefined;
  if (!message) return res.status(400).json({ error: "message is required" });
  if (proposalId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId)) {
    return res.status(400).json({ error: "proposalId must be a valid UUID" });
  }
  if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return res.status(400).json({ error: "operationId must be a valid UUID" });
  }

  const { rootPath, id: projectId } = req.project!;
  const correlationId = operationId ?? proposalId ?? randomUUID();

  try {
    await assertRootPathExists(rootPath);
    let scopedPaths: string[] | undefined;
    if (proposalId) {
      const [proposal] = await db
        .select()
        .from(aiChangeProposalsTable)
        .where(and(
          eq(aiChangeProposalsTable.id, proposalId),
          eq(aiChangeProposalsTable.projectId, projectId),
        ))
        .limit(1);
      if (!proposal) {
        return res.status(404).json({ error: "AI change proposal not found", code: "AI_PROPOSAL_NOT_FOUND" });
      }
      if (proposal.status !== "applied") {
        return res.status(409).json({
          error: "AI changes must pass Apply and behavioral verification before commit",
          code: "AI_COMMIT_REQUIRES_VERIFIED_APPLY",
        });
      }
      if (
        proposal.workspaceRoot
        && proposal.lifecycle !== "applied"
        && proposal.lifecycle !== "validated"
      ) {
        return res.status(409).json({
          error: "AI proposal is not in a committable lifecycle state",
          code: "AI_COMMIT_LIFECYCLE_BLOCKED",
          lifecycle: proposal.lifecycle,
        });
      }
      const applyEvidence = await findOperationEvent(projectId, "AiChangesApplied", correlationId);
      if (
        !applyEvidence ||
        applyEvidence.proposalId !== proposalId ||
        applyEvidence.operationId !== correlationId ||
        applyEvidence.applyStatus !== "APPLIED"
      ) {
        return res.status(409).json({
          error: "AI commit requires a recorded successful Apply operation for this proposal and operation",
          code: "AI_COMMIT_REQUIRES_APPLY_EVIDENCE",
          proposalId,
          operationId: correlationId,
        });
      }

      let storedChanges: unknown;
      try {
        storedChanges = JSON.parse(proposal.changes);
      } catch {
        return res.status(500).json({ error: "Stored AI change proposal is invalid", code: "AI_PROPOSAL_INVALID" });
      }
      if (
        !Array.isArray(storedChanges) ||
        storedChanges.length === 0 ||
        storedChanges.some((change) =>
          !change ||
          typeof change !== "object" ||
          typeof (change as { path?: unknown }).path !== "string" ||
          typeof (change as { newContent?: unknown }).newContent !== "string",
        )
      ) {
        return res.status(500).json({ error: "Stored AI change proposal has no valid file scope", code: "AI_PROPOSAL_SCOPE_INVALID" });
      }
      scopedPaths = [...new Set(storedChanges.map((change) => (change as { path: string }).path))];
      const invalidPath = scopedPaths.find((candidate) => {
        const normalized = candidate.replaceAll("\\", "/");
        return (
          !normalized ||
          normalized.startsWith("/") ||
          path.isAbsolute(candidate) ||
          normalized.split("/").some((segment) => segment === ".." || segment.length === 0)
        );
      });
      if (invalidPath) {
        return res.status(409).json({
          error: "AI change proposal contains an unsafe file path",
          code: "AI_PROPOSAL_SCOPE_INVALID",
          path: invalidPath,
        });
      }

      // Apply proof is content-bound, not just event-bound. A user may have
      // edited an applied file after validation, or another actor may have
      // changed the working tree. Never commit that drift under the original
      // proposal identity.
      for (const change of storedChanges as Array<{ path: string; newContent: string }>) {
        const absolutePath = path.resolve(rootPath, change.path);
        if (absolutePath !== path.resolve(rootPath) && !absolutePath.startsWith(`${path.resolve(rootPath)}${path.sep}`)) {
          return res.status(409).json({
            error: "AI change proposal contains a path outside the project root",
            code: "AI_PROPOSAL_SCOPE_INVALID",
            path: change.path,
          });
        }
        let currentContent: string;
        try {
          currentContent = await fsReadFile(absolutePath, "utf8");
        } catch {
          return res.status(409).json({
            error: "An applied AI file is no longer present; commit requires a fresh Apply",
            code: "AI_COMMIT_APPLY_DRIFT",
            path: change.path,
          });
        }
        if (currentContent !== change.newContent) {
          return res.status(409).json({
            error: "An applied AI file changed after verification; commit requires a fresh Apply",
            code: "AI_COMMIT_APPLY_DRIFT",
            path: change.path,
          });
        }
      }

      const { stdout: stagedOutput } = await runGit(["diff", "--cached", "--name-only", "-z"], rootPath);
      const stagedPaths = stagedOutput.split("\0").filter(Boolean);
      const unrelatedStaged = stagedPaths.filter((candidate) => !scopedPaths!.includes(candidate));
      if (unrelatedStaged.length > 0) {
        return res.status(409).json({
          error: "Scoped AI commit blocked by unrelated staged changes",
          code: "AI_COMMIT_UNRELATED_STAGED_CHANGES",
          paths: unrelatedStaged,
        });
      }

      // A scoped AI commit must be the only pending filesystem change. This
      // includes unstaged changes and untracked files, not just the staged
      // index, so unrelated work cannot silently remain alongside the proof.
      const { stdout: statusOutput } = await runGit([
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "-z",
      ], rootPath);
      const workingTreePaths = statusOutput
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(3).split(" -> ").at(-1) ?? entry.slice(3))
        .filter(Boolean);
      const unrelatedWorkingTree = workingTreePaths.filter((candidate) => !scopedPaths!.includes(candidate));
      if (unrelatedWorkingTree.length > 0) {
        return res.status(409).json({
          error: "Scoped AI commit blocked by unrelated working-tree changes",
          code: "AI_COMMIT_UNRELATED_WORKTREE_CHANGES",
          paths: unrelatedWorkingTree,
        });
      }

      // Stage only the paths from the server-owned, already-verified proposal.
      await runGit(["add", "--", ...scopedPaths], rootPath);
    } else {
      // Generic Git commits retain their existing behavior.
      await runGit(["add", "-A"], rootPath);
    }

    // Commit with a fixed identity so git never fails on "user.email not set"
    const { stdout, stderr } = await runGit(
      [
        "-c", "user.name=EngineeringOS",
        "-c", "user.email=ai@engineeringos.local",
        "commit", "-m", message.trim(),
      ],
      rootPath,
    );
    const { stdout: commitHash } = await runGit(["rev-parse", "HEAD"], rootPath);
    const committedPaths = scopedPaths ?? (await runGit(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      rootPath,
    )).stdout.split("\n").filter(Boolean);

    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "executed",
      projectId,
      stateBefore: {},
      stateAfter: { commitMessage: message.trim(), commitHash, committedPaths, proposalId: proposalId ?? null },
      correlationId,
    });

    // G-14: emit a high-level event so commit appears in the dashboard
    // activity feed and in the AI context's recentEvents.
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "GitCommitCreated",
      projectId,
      severity: "info",
      message: `Git commit: ${message.trim().slice(0, 120)}`,
      correlationId,
      payload: {
        ...(proposalId ? { proposalId } : {}),
        operationId: correlationId,
        commitHash,
        committedPaths,
      },
    });
    if (proposalId) {
      await db.update(aiChangeProposalsTable)
        .set({ lifecycle: "committed", committedHash: commitHash })
        .where(and(
          eq(aiChangeProposalsTable.id, proposalId),
          eq(aiChangeProposalsTable.lifecycle, "applied"),
        ));
    }

    invalidateContextCache(projectId);

    return res.json({ ok: true, output: stdout || stderr, correlationId, commitHash, committedPaths });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    // "nothing to commit" is not an error from the user's perspective
    const msg = e.stderr?.trim() || e.stdout?.trim() || e.message || "git commit failed";
    if (msg.includes("nothing to commit")) {
      return res.status(409).json({ error: "Nothing to commit — working tree is clean." });
    }
    return res.status(500).json({ error: redact(msg) });
  }
});

/** POST /api/projects/:projectId/git/push — push through GitHub connector or legacy HTTPS token */
router.post("/projects/:projectId/git/push", requireProjectWriteAccess, async (req, res) => {
  const project = req.project!;
  const body = (req.body ?? {}) as { proposalId?: unknown };
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : undefined;
  const operationId = typeof (body as { operationId?: unknown }).operationId === "string"
    ? (body as { operationId: string }).operationId
    : undefined;
  if (proposalId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId)) {
    return res.status(400).json({ error: "proposalId must be a valid UUID" });
  }
  if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return res.status(400).json({ error: "operationId must be a valid UUID" });
  }
  const correlationId = operationId ?? proposalId ?? randomUUID();

  if (!project.gitRemoteUrl) {
    return res.status(400).json({
      error: "No remote URL configured for this project. Add one in the Git settings panel.",
    });
  }

  const allowLegacyFixture = config.nodeEnv === "test" && project.gitRemoteUrl === TEST_FIXTURE_REMOTE;
  if (!parseGitHubRemote(project.gitRemoteUrl) && !allowLegacyFixture) {
    return res.status(400).json({
      error: "Remote URL must be a credential-free HTTPS github.com repository URL.",
      code: "UNSAFE_REMOTE_URL",
    });
  }

  const branch = project.gitDefaultBranch ?? "main";
  const githubRemote = parseGitHubRemote(project.gitRemoteUrl);

  try {
    await assertRootPathExists(project.rootPath);
    let commitHash: string | undefined;
    if (proposalId) {
      const [proposal] = await db
        .select({
          lifecycle: aiChangeProposalsTable.lifecycle,
          operationId: aiChangeProposalsTable.operationId,
        })
        .from(aiChangeProposalsTable)
        .where(and(
          eq(aiChangeProposalsTable.id, proposalId),
          eq(aiChangeProposalsTable.projectId, project.id),
        ))
        .limit(1);
      if (
        !proposal
        || (
          proposal.operationId
          && (proposal.operationId !== correlationId || proposal.lifecycle !== "committed")
        )
      ) {
        return res.status(409).json({
          error: "AI push requires the same committed delivery operation",
          code: "AI_PUSH_LIFECYCLE_BLOCKED",
          proposalId,
          operationId: correlationId,
          lifecycle: proposal?.lifecycle ?? null,
        });
      }
      const commitEvidence = await findOperationEvent(project.id, "GitCommitCreated", correlationId);
      commitHash = typeof commitEvidence?.commitHash === "string" ? commitEvidence.commitHash : undefined;
      if (
        !commitEvidence ||
        commitEvidence.proposalId !== proposalId ||
        commitEvidence.operationId !== correlationId ||
        !commitHash
      ) {
        return res.status(409).json({
          error: "AI push requires a recorded commit operation for this proposal and operation",
          code: "AI_PUSH_REQUIRES_COMMIT_EVIDENCE",
          proposalId,
          operationId: correlationId,
        });
      }
      const { stdout: currentHead } = await runGit(["rev-parse", "HEAD"], project.rootPath);
      if (currentHead !== commitHash) {
        return res.status(409).json({
          error: "The repository changed after the recorded AI commit; commit again before pushing",
          code: "AI_PUSH_COMMIT_DRIFT",
          expectedCommit: commitHash,
          actualCommit: currentHead,
        });
      }
    } else {
      commitHash = (await runGit(["rev-parse", "HEAD"], project.rootPath)).stdout;
    }
    let output = "";
    let remoteCommitHash: string | undefined;
    if (githubRemote) {
      if (!commitHash) {
        return res.status(409).json({
          error: "A local commit is required before pushing through the GitHub integration",
          code: "GITHUB_PUSH_REQUIRES_LOCAL_COMMIT",
        });
      }
      const pushed = await pushLocalCommitToGitHub({
        rootPath: project.rootPath,
        remote: githubRemote,
        branch,
        commitHash,
        message: `EngineeringOS: ${branch}`,
      });
      remoteCommitHash = pushed.remoteCommitHash;
      output = `Pushed ${pushed.changedPaths.length} verified path(s) through GitHub integration`;
    } else if (allowLegacyFixture) {
      const token = await getGithubToken(req.userId);
      if (!token) return res.status(428).json({ error: "GitHub authentication is not configured." });
      const result = await runGit(
        ["push", buildAuthUrl(project.gitRemoteUrl, token), branch],
        project.rootPath,
        { timeout: 60_000 },
      );
      output = result.stdout || result.stderr;
      remoteCommitHash = commitHash;
    } else {
      return res.status(400).json({
        error: "Only GitHub remotes can be pushed through this API.",
        code: "UNSAFE_REMOTE_URL",
      });
    }

    await recordAudit({
      entityType: "project",
      entityId: project.id,
      action: "executed",
      projectId: project.id,
      stateBefore: {},
      stateAfter: {
        branch,
        remoteUrl: project.gitRemoteUrl,
        commitHash,
        remoteCommitHash,
        proposalId: proposalId ?? null,
      },
      correlationId,
    });

    // G-14: emit a high-level event so push appears in dashboard activity feed
    // and in the AI context's recentEvents on the next chat request.
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "GitPushed",
      projectId: project.id,
      severity: "info",
      message: `Pushed branch "${branch}" to ${project.gitRemoteUrl}`,
      correlationId,
      payload: {
        ...(proposalId ? { proposalId } : {}),
        operationId: correlationId,
        commitHash,
        remoteCommitHash,
        branch,
        remoteUrl: project.gitRemoteUrl,
      },
    });

    invalidateContextCache(project.id);

    // G-03: fire-and-forget post-push scan so the knowledge graph and metrics
    // reflect the new code without requiring a manual scan click.  We run this
    // after the response is sent to avoid blocking the push acknowledgement.
    setImmediate(async () => {
      const scanNow = new Date();
      const jobId = randomUUID();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(scanJobsTable).values({
            id: jobId,
            projectId: project.id,
            status: "queued",
            createdAt: scanNow,
          });

          await tx.update(projectsTable).set({ status: "scanning", updatedAt: scanNow }).where(eq(projectsTable.id, project.id));

          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "ProjectScanQueued",
            projectId: project.id,
            severity: "info",
            message: "Automatic scan queued after push",
            correlationId: jobId,
            payload: { parentCorrelationId: correlationId },
          });
        });

        // PR-D1: enqueueWithId prevents duplicate execution if the stale-pending
        // sweep re-fires before this closure has had a chance to start.
        heavyJobQueue.enqueueWithId(jobId, () => runScanJob(jobId, project.id));
        invalidateContextCache(project.id);
      } catch (scanErr) {
        // Non-fatal — log and emit a warning event so the failure is visible in
        // the dashboard activity feed; the push itself succeeded.
        logger.error({ err: scanErr, projectId: project.id, scope: "git-push" }, "post-push scan failed");
        await db.transaction(async (tx) => {
          await tx
            .update(scanJobsTable)
            .set({
              status: "failed",
              error: "Failed to queue post-push scan",
              finishedAt: new Date(),
            })
            .where(eq(scanJobsTable.id, jobId));

          await tx
            .update(projectsTable)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(projectsTable.id, project.id));

          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "ProjectScanFailed",
            projectId: project.id,
            severity: "warning",
            message: "Post-push automatic scan failed — trigger a manual scan to refresh the knowledge graph.",
           payload: { error: String(scanErr), parentCorrelationId: correlationId },
          });
        }).catch(() => {});
        invalidateContextCache(project.id);
      }
    });

    return res.json({ ok: true, branch, output: redact(output), correlationId, commitHash, remoteCommitHash });
  } catch (err) {
    if (err instanceof GitHubConnectorError && err.code === "GITHUB_PUSH_REMOTE_DRIFT") {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        proposalId,
        operationId: correlationId,
      });
    }
    if (
      err instanceof GitHubConnectorError &&
      (err.code === "GITHUB_CONNECTOR_UNAVAILABLE" || err.status === 401 || err.status === 403)
    ) {
      return res.status(502).json({
        error: "GitHub integration authentication failed or is unavailable. Reconnect GitHub and retry.",
        code: "GITHUB_INTEGRATION_AUTH_FAILED",
      });
    }
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const raw = e.stderr?.trim() || e.stdout?.trim() || e.message || "git push failed";
    return res.status(500).json({ error: redact(raw) });
  }
});

/** GET /api/projects/:projectId/export — stream a tar.gz snapshot of the project root */
router.get("/projects/:projectId/export", requireProjectAccess, (req, res) => {
  const project = req.project!;
  const safeName = project.name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeName}.tar.gz"`,
  );

  // Stream the project directory as a gzipped tar archive directly to the
  // response. -C changes into rootPath first so paths inside the archive are
  // relative (e.g. "src/index.ts" not "/home/runner/.../src/index.ts").
  const tar = spawn("tar", ["-czf", "-", "-C", project.rootPath, "."], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tar.stdout.pipe(res);

  tar.stderr.on("data", (chunk: Buffer) => {
    // Log but never expose to client (may contain absolute paths).
    console.error("[export] tar stderr:", chunk.toString().trim());
  });

  tar.on("error", (err) => {
    console.error("[export] spawn error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create archive." });
    } else {
      res.destroy();
    }
  });

  tar.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.destroy();
    }
  });
});

export default router;
