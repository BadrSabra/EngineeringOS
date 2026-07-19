/**
 * Source adapters for the discovery pipeline.
 *
 * Each adapter encapsulates all logic for one SourceType: config validation,
 * async resolution to a local rootPath, and optional cleanup of temporary
 * resources. The route only calls `resolveSource`; adding a new source type
 * requires only a new entry in `ADAPTERS` — no changes to the route.
 *
 * Contract:
 *   SupportedAdapter.validate(config) → error | null      (sync)
 *   SupportedAdapter.resolve(config)  → rootPath | error  (async)
 *   SupportedAdapter.cleanup(tempDir) → void              (async, optional)
 *
 *   UnsupportedAdapter.available === false — resolveSource returns 501.
 */

import { rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Redacts any embedded `user:password@` credentials from a URL string.
 * Used to sanitize error messages before they are returned to clients or
 * written to logs — git clone errors include the full command, which may
 * contain a token-injected clone URL in plain text.
 */
function redactUrlCredentials(text: string): string {
  return text.replace(/https?:\/\/[^@\s"']+@/g, "https://[credentials-redacted]@");
}

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export type SourceConfig = {
  path?: string;
  url?: string;
  branch?: string;
  credentials?: { username: string; token: string };
  uploadId?: string;
  projectId?: string;
};

/**
 * Machine-readable failure category, alongside the human-readable `error`
 * message. Callers (routes, tests) can branch on `reason` without parsing
 * message text; the message stays free to change wording without breaking
 * anything.
 */
export type ResolveErrorReason =
  | "invalid_source"
  | "unsupported_source"
  | "not_found"
  | "permission_denied"
  | "resolution_failed";

export type ResolveSuccess = {
  rootPath: string;
  tempDir?: string;
  /**
   * Adapter-provided cleanup hook. When set, `cleanupResolveResult` delegates
   * to this function instead of calling `rm` directly, so cleanup logic lives
   * in a single place — the adapter — rather than being duplicated at every
   * call site.
   */
  cleanup?: () => Promise<void>;
};
export type ResolveError = { error: string; status: number; reason: ResolveErrorReason };
export type ResolveResult = ResolveSuccess | ResolveError;

/** Context available to every adapter's resolve(), regardless of source type. */
export interface ResolveContext {
  /** The authenticated user requesting resolution — used to scope any
   * source that references another first-class resource (e.g. an existing
   * project) so one user's discovery flow can never resolve to a path or
   * resource owned by someone else. */
  userId: string;
}

/** Returns true when `result` is an error (narrows the union). */
export function isResolveError(result: ResolveResult): result is ResolveError {
  return "error" in result;
}

export interface SupportedAdapter {
  available: true;
  /** Validate required config fields. Returns an error descriptor or null. */
  validate(config: SourceConfig): ResolveError | null;
  /** Resolve config to a local rootPath; may perform async work (e.g. git clone). */
  resolve(config: SourceConfig, ctx: ResolveContext): Promise<ResolveResult>;
  /** Clean up any temporary resources created by resolve (e.g. a cloned repo dir). */
  cleanup?(tempDir: string): Promise<void>;
}

export interface UnsupportedAdapter {
  available: false;
  /** Human-readable reason, surfaced in the 501 response. */
  reason: string;
}

export type SourceAdapter = SupportedAdapter | UnsupportedAdapter;

// ─── LOCAL_FOLDER ─────────────────────────────────────────────────────────────

const localFolderAdapter: SupportedAdapter = {
  available: true,

  validate(config) {
    if (!config.path) {
      return { error: "sourceConfig.path is required for LOCAL_FOLDER", status: 400, reason: "invalid_source" };
    }
    return null;
  },

  async resolve(config) {
    const p = config.path!;
    const normalized = p.startsWith("/") ? p : `/${p}`;
    return { rootPath: normalized };
  },
};

// ─── GIT_REPOSITORY ───────────────────────────────────────────────────────────

const gitRepositoryAdapter: SupportedAdapter = {
  available: true,

  validate(config) {
    if (!config.url) {
      return { error: "sourceConfig.url is required for GIT_REPOSITORY", status: 400, reason: "invalid_source" };
    }

    // Scheme whitelist — only HTTPS (and HTTP for local/internal registries).
    // Reject file://, ssh://, git://, and bare SCP-syntax (git@host:path)
    // paths which could be used to clone local filesystem paths or bypass
    // the expected authentication model.
    const url = config.url.trim();
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return {
        error: "Only HTTPS (and HTTP) repository URLs are supported. SSH and file:// URLs are not permitted.",
        status: 400,
        reason: "invalid_source",
      };
    }

    return null;
  },

  async resolve(config) {
    const url = config.url!;
    const tempDir = `/tmp/eos-git-${randomUUID()}`;
    const cloneArgs: string[] = ["clone", "--depth", "1"];

    if (config.branch) cloneArgs.push("-b", config.branch);

    // Inject credentials into the URL for private repos.
    let cloneUrl = url;
    if (config.credentials?.token) {
      try {
        const parsed = new URL(url);
        parsed.username = config.credentials.username ?? "oauth2";
        parsed.password = config.credentials.token;
        cloneUrl = parsed.toString();
      } catch (parseErr) {
        // URL parse failed — log a warning so operators can diagnose mis-configured
        // credentials, then fall through to the raw URL and let git surface the error.
        console.warn(
          JSON.stringify({
            scope: "git-adapter",
            code: "URL_PARSE_FAILED",
            error: parseErr instanceof Error ? parseErr.message : String(parseErr),
            hint: "Credential injection skipped; clone will proceed without authentication.",
          }),
        );
      }
    }
    cloneArgs.push(cloneUrl, tempDir);

    // Define the cleanup function once so both the success path (returned as
    // a hook on ResolveSuccess) and the failure path (partial clone) share the
    // same logic. If cleanup semantics ever change, this is the only place.
    const doCleanup = (): Promise<void> =>
      rm(tempDir, { recursive: true, force: true }).then(() => undefined).catch(() => undefined);

    try {
      await execFileAsync("git", cloneArgs, { timeout: 120_000 });
      // Attach the cleanup hook so callers (cleanupResolveResult) always
      // delegate here rather than calling rm directly.
      return { rootPath: tempDir, tempDir, cleanup: doCleanup };
    } catch (err) {
      // Clean up the partial clone before returning the error — same fn.
      void doCleanup();
      // Redact any embedded credentials before surfacing the message.
      // execFileAsync includes the full command in err.message on failure,
      // which may contain the token-injected clone URL in plain text.
      const raw = err instanceof Error ? err.message : String(err);
      const msg = redactUrlCredentials(raw);
      return { error: `Git clone failed: ${msg}`, status: 422, reason: "resolution_failed" };
    }
  },
};

// ─── WORKSPACE_PROJECT ────────────────────────────────────────────────────────

const workspaceProjectAdapter: SupportedAdapter = {
  available: true,

  validate(config) {
    if (!config.projectId) {
      return { error: "sourceConfig.projectId is required for WORKSPACE_PROJECT", status: 400, reason: "invalid_source" };
    }
    return null;
  },

  // Re-scanning an existing project must stay within the requesting user's
  // own projects. Without this check, any authenticated user could supply
  // another user's projectId and have discovery walk that user's rootPath
  // on their behalf — leaking file contents/paths of a project they don't
  // own into a session (and, if imported, a project) they *do* own. 404 for
  // "no such project" and 403 for "exists, not yours" mirrors the same
  // not-found-vs-forbidden convention used by requireProjectAccess.
  async resolve(config, ctx) {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, config.projectId!))
      .limit(1);
    if (!rows[0]) {
      return { error: `Project not found: ${config.projectId}`, status: 404, reason: "not_found" };
    }
    if (rows[0].ownerId !== ctx.userId) {
      return {
        error: "You do not have access to this project",
        status: 403,
        reason: "permission_denied",
      };
    }
    return { rootPath: rows[0].rootPath };
  },
};

// ─── Unsupported adapters ──────────────────────────────────────────────────────
// These source types are known but not implemented in this deployment.
// resolveSource returns { status: 501, reason: "unsupported_source" } for them;
// the route maps that to an HTTP 501 — no JS exception escapes to the generic
// error handler.

const archiveUploadAdapter: UnsupportedAdapter = {
  available: false,
  reason:
    "Archive upload requires server-side file-upload handling that is not " +
    "available in this deployment. To scan code from a zip or tarball, push " +
    "it to a Git repository and use the GIT_REPOSITORY source type instead.",
};

const remoteFilesystemAdapter: UnsupportedAdapter = {
  available: false,
  reason:
    "Remote filesystem mounting via SSH/SFTP requires server-side file " +
    "access that is not supported in this deployment.",
};

const dockerVolumeAdapter: UnsupportedAdapter = {
  available: false,
  reason:
    "Docker volume access requires a local Docker daemon, which is not " +
    "available in this deployment. To scan a container's source code, clone " +
    "its repository via GIT_REPOSITORY instead.",
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Maps every SourceType enum value to its adapter.
 * Adding a new source type: add a new entry here. The route never needs to change.
 */
export const ADAPTERS: Record<string, SourceAdapter> = {
  LOCAL_FOLDER: localFolderAdapter,
  GIT_REPOSITORY: gitRepositoryAdapter,
  WORKSPACE_PROJECT: workspaceProjectAdapter,
  ARCHIVE_UPLOAD: archiveUploadAdapter,
  REMOTE_FILESYSTEM: remoteFilesystemAdapter,
  DOCKER_VOLUME: dockerVolumeAdapter,
};

// ─── Public facade ────────────────────────────────────────────────────────────

/**
 * Resolves a source type + config to a local filesystem rootPath.
 * Returns `ResolveSuccess` on success or `ResolveError` on failure.
 * All adapter-specific validation and async work is handled here.
 */
export async function resolveSource(
  sourceType: string,
  sourceConfig: SourceConfig,
  userId: string,
): Promise<ResolveResult> {
  const adapter = ADAPTERS[sourceType];

  if (!adapter) {
    return { error: `Unknown source type: ${sourceType}`, status: 400, reason: "invalid_source" };
  }

  if (!adapter.available) {
    return {
      error: `Source type '${sourceType}' is not yet available in this environment`,
      status: 501,
      reason: "unsupported_source",
    };
  }

  const validationError = adapter.validate(sourceConfig);
  if (validationError) return validationError;

  return adapter.resolve(sourceConfig, { userId });
}

/**
 * Cleans up any temporary filesystem resources that were created during
 * resolution (e.g. a git clone directory). Safe to call on any ResolveResult.
 *
 * Delegates to the adapter-provided `cleanup` hook when present — that keeps
 * all cleanup logic in one place (the adapter). Falls back to a direct `rm`
 * for legacy/simple sources that do not supply a hook but still set `tempDir`.
 */
export async function cleanupResolveResult(result: ResolveResult): Promise<void> {
  if (isResolveError(result)) return;
  if (result.cleanup) {
    await result.cleanup();
  } else if (result.tempDir) {
    await rm(result.tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
