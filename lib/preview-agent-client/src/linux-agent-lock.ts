import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type LockRecord = {
  version: 1;
  pid: number;
  processIdentity: string;
  lockId: string;
};

export class PreviewAgentLockError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_ALREADY_RUNNING"
      | "PREVIEW_AGENT_LOCK_UNAVAILABLE",
  ) {
    super("Preview Agent process ownership could not be established.");
    this.name = "PreviewAgentLockError";
  }
}

export async function withLinuxAgentLock<T>(
  nodeId: string,
  run: () => Promise<T>,
  options: {
    stateDirectory?: string;
    pid?: number;
    processIdentity?: (pid: number) => Promise<string | null>;
    isProcessAlive?: (pid: number) => boolean;
  } = {},
): Promise<T> {
  if (
    process.platform !== "linux" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      nodeId,
    )
  ) {
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  }
  const pid = options.pid ?? process.pid;
  const stateDirectory =
    options.stateDirectory ??
    path.join(
      process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"),
      "engineeringos-preview-agent",
    );
  if (!path.isAbsolute(stateDirectory)) {
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  }
  const lockPath = path.join(stateDirectory, `${nodeId}.lock`);
  const readIdentity = options.processIdentity ?? linuxProcessIdentity;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  let currentProcessIdentity: string | null;

  try {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const directory = await lstat(stateDirectory);
    if (
      !directory.isDirectory() ||
      (typeof process.getuid === "function" &&
        directory.uid !== process.getuid()) ||
      (directory.mode & 0o077) !== 0
    ) {
      throw new Error("State directory is not private.");
    }
    currentProcessIdentity = await readIdentity(pid);
  } catch {
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  }
  if (!currentProcessIdentity) {
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  }

  const lock: LockRecord = {
    version: 1,
    pid,
    processIdentity: currentProcessIdentity,
    lockId: randomUUID(),
  };
  const contents = JSON.stringify(lock);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(contents, { encoding: "utf8" });
        await handle.sync();
        break;
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => undefined);
          handle = undefined;
        }
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const existingContents = await readStableLock(lockPath);
        const existing = parseLock(existingContents);
        const existingIdentity = await readIdentity(existing.pid);
        const alive = isProcessAlive(existing.pid);
        if (
          alive &&
          existingIdentity !== null &&
          existingIdentity === existing.processIdentity
        ) {
          throw new PreviewAgentLockError("PREVIEW_AGENT_ALREADY_RUNNING");
        }

        // Remove only the exact stale lock we inspected. If another process
        // replaced it, fail closed rather than unlinking its ownership marker.
        if ((await readStableLock(lockPath)) !== existingContents) {
          throw new PreviewAgentLockError("PREVIEW_AGENT_ALREADY_RUNNING");
        }
        await unlink(lockPath);
        if (attempt === 1) {
          throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
        }
      }
    }
    if (!handle) {
      throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
    }
    await handle.close();
    handle = undefined;
    return await run();
  } catch (error) {
    if (error instanceof PreviewAgentLockError) throw error;
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    try {
      const current = parseLock(await readStableLock(lockPath));
      if (current.lockId === lock.lockId) await unlink(lockPath);
    } catch {
      // Do not remove an unknown or replaced lock during cleanup.
    }
  }
}

async function readStableLock(lockPath: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const first = await readFile(lockPath, "utf8");
      JSON.parse(first);
      const second = await readFile(lockPath, "utf8");
      if (first === second) return first;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
}

function parseLock(contents: string): LockRecord {
  try {
    const value = JSON.parse(contents) as Partial<LockRecord>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.processIdentity !== "string" ||
      value.processIdentity.length > 256 ||
      typeof value.lockId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.lockId)
    ) {
      throw new Error("Invalid lock data.");
    }
    return value as LockRecord;
  } catch {
    throw new PreviewAgentLockError("PREVIEW_AGENT_LOCK_UNAVAILABLE");
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true;
  }
}

async function linuxProcessIdentity(pid: number): Promise<string | null> {
  try {
    const [bootId, statLine] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const lastParen = statLine.lastIndexOf(")");
    if (lastParen < 0) return null;
    const fieldsAfterCommand = statLine.slice(lastParen + 1).trim().split(/\s+/);
    const startTime = fieldsAfterCommand[19];
    if (!startTime || !/^\d+$/.test(startTime)) return null;
    return `${bootId.trim()}:${startTime}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
