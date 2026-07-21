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
import { db } from "@workspace/db";
import {
  projectsTable,
  aiProviderCredentialsTable,
  eventsTable,
  scanJobsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { runScanJob } from "../lib/scan-runner.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import { requireProjectAccess, requireProjectWriteAccess } from "../middlewares/requireProjectAccess.js";
import { encryptApiKey, decryptApiKey } from "../lib/credentials-crypto.js";
import { recordAudit } from "../lib/audit.js";

const router = Router();
const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 2 * 1024 * 1024; // 2 MB

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

/** Inject PAT into an HTTPS GitHub URL. Never logs the result. */
function buildAuthUrl(remoteUrl: string, token: string): string {
  return remoteUrl.replace(/^https?:\/\//, `https://x-access-token:${token}@`);
}

/** Redact any embedded token from a git error message before returning to client. */
function redact(s: string): string {
  return s.replace(/x-access-token:[^@]+@/g, "x-access-token:[REDACTED]@");
}

async function getGithubToken(userId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(aiProviderCredentialsTable)
    .where(
      and(
        eq(aiProviderCredentialsTable.ownerId, userId),
        eq(aiProviderCredentialsTable.provider, "github"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  try {
    return decryptApiKey(rows[0].encryptedApiKey);
  } catch {
    return null;
  }
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
    if (raw.includes("not a git repository")) {
      return res.status(400).json({
        error: "not_a_git_repo",
        hint: "This project directory is not a git repository. Run `git init` inside it or link an existing repo.",
      });
    }
    return res.status(500).json({ error: raw });
  }
});

/** GET /api/projects/:projectId/git/log */
router.get("/projects/:projectId/git/log", requireProjectAccess, async (req, res) => {
  const { rootPath } = req.project!;
  try {
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
    if (raw.includes("not a git repository")) {
      return res.status(400).json({
        error: "not_a_git_repo",
        hint: "This project directory is not a git repository.",
      });
    }
    return res.status(500).json({ error: raw });
  }
});

// ── Git write operations ──────────────────────────────────────────────────────

/** POST /api/projects/:projectId/git/commit — stage all changes and commit */
router.post("/projects/:projectId/git/commit", requireProjectWriteAccess, async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });

  const { rootPath, id: projectId } = req.project!;

  try {
    // Stage everything
    await runGit(["add", "-A"], rootPath);

    // Commit with a fixed identity so git never fails on "user.email not set"
    const { stdout, stderr } = await runGit(
      [
        "-c", "user.name=EngineeringOS",
        "-c", "user.email=ai@engineeringos.local",
        "commit", "-m", message.trim(),
      ],
      rootPath,
    );

    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "executed",
      projectId,
      stateBefore: {},
      stateAfter: { commitMessage: message.trim() },
    });

    // G-14: emit a high-level event so commit appears in the dashboard
    // activity feed and in the AI context's recentEvents.
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "GitCommitCreated",
      projectId,
      severity: "info",
      message: `Git commit: ${message.trim().slice(0, 120)}`,
    });

    return res.json({ ok: true, output: stdout || stderr });
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

/** POST /api/projects/:projectId/git/push — push to remote using stored GitHub token */
router.post("/projects/:projectId/git/push", requireProjectWriteAccess, async (req, res) => {
  const project = req.project!;

  if (!project.gitRemoteUrl) {
    return res.status(400).json({
      error: "No remote URL configured for this project. Add one in the Git settings panel.",
    });
  }

  const token = await getGithubToken(req.userId);
  if (!token) {
    return res.status(428).json({
      error: "GitHub token not configured. Add a Personal Access Token in the Git settings panel.",
    });
  }

  if (!project.gitRemoteUrl.match(/^https?:\/\//)) {
    return res.status(400).json({
      error:
        "Remote URL must be an HTTPS URL (e.g. https://github.com/owner/repo.git). SSH URLs are not supported — switch to the HTTPS remote in Git settings.",
    });
  }

  const branch = project.gitDefaultBranch ?? "main";
  const authUrl = buildAuthUrl(project.gitRemoteUrl, token);

  try {
    const { stdout, stderr } = await runGit(
      ["push", authUrl, branch],
      project.rootPath,
      { timeout: 60_000 },
    );

    await recordAudit({
      entityType: "project",
      entityId: project.id,
      action: "executed",
      projectId: project.id,
      stateBefore: {},
      stateAfter: { branch, remoteUrl: project.gitRemoteUrl },
    });

    // G-14: emit a high-level event so push appears in dashboard activity feed
    // and in the AI context's recentEvents on the next chat request.
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "GitPushed",
      projectId: project.id,
      severity: "info",
      message: `Pushed branch "${branch}" to ${project.gitRemoteUrl}`,
    });

    // G-03: fire-and-forget post-push scan so the knowledge graph and metrics
    // reflect the new code without requiring a manual scan click.  We run this
    // after the response is sent to avoid blocking the push acknowledgement.
    setImmediate(async () => {
      try {
        const jobId = randomUUID();
        const scanNow = new Date();
        await db.insert(scanJobsTable).values({ id: jobId, projectId: project.id, status: "queued", createdAt: scanNow });
        await db.update(projectsTable).set({ status: "scanning", updatedAt: scanNow }).where(eq(projectsTable.id, project.id));
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "ProjectScanQueued",
          projectId: project.id,
          severity: "info",
          message: "Automatic scan queued after push",
          correlationId: jobId,
        });
        // PR-D1: enqueueWithId prevents duplicate execution if the stale-pending
        // sweep re-fires before this closure has had a chance to start.
        heavyJobQueue.enqueueWithId(jobId, () => runScanJob(jobId, project.id));
      } catch (scanErr) {
        // Non-fatal — log but never surface to the user; the push itself succeeded.
        console.error(JSON.stringify({ scope: "git-push", code: "POST_PUSH_SCAN_FAILED", error: String(scanErr) }));
      }
    });

    return res.json({ ok: true, branch, output: redact(stdout || stderr) });
  } catch (err) {
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
