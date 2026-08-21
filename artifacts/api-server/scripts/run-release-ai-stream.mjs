#!/usr/bin/env node

import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const expectedTest = path.join(
  artifactRoot,
  "src",
  "routes",
  "ai-stream-integration.test.ts",
);
export const lockPath = path.join(
  process.env.TMPDIR || "/tmp",
  "engineeringos-api-stream-release.lock",
);

const ownerFile = (directory) => path.join(directory, "owner.json");
const ownerToken = () =>
  `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function readProcessIdentity(
  pid,
  { procRoot = "/proc", kill = process.kill, read = readFile } = {},
) {
  try {
    kill(pid, 0);
    const stat = String(await read(path.join(procRoot, String(pid), "stat")));
    const closeParen = stat.lastIndexOf(") ");
    if (closeParen < 0) return null;
    const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
    const startTime = fields[19];
    return startTime ? { pid, startTime } : null;
  } catch {
    return null;
  }
}

async function processOwnerIsActive(
  owner,
  { procRoot = "/proc", kill = process.kill, read = readFile } = {},
) {
  try {
    kill(owner.pid, 0);
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
  let stat;
  try {
    stat = String(await read(path.join(procRoot, String(owner.pid), "stat")));
  } catch {
    return null;
  }
  const closeParen = stat.lastIndexOf(") ");
  if (closeParen < 0) return null;
  const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
  const startTime = fields[19];
  if (!startTime) return null;
  return startTime === owner.processStartTime;
}

export async function acquireReleaseLock(
  targetPath,
  {
    mkdirDirectory = mkdir,
    read = readFile,
    write = writeFile,
    renamePath = rename,
    remove = rm,
    now = () => Date.now(),
    token = ownerToken(),
    identity = () => readProcessIdentity(process.pid),
    isOwnerActive = (owner) => processOwnerIsActive(owner),
    reclaimPath = `${targetPath}.reclaim-${process.pid}-${Date.now()}`,
  } = {},
) {
  const owner = await identity();
  if (!owner?.pid || !owner?.startTime) {
    throw new Error("Cannot establish a verifiable release lock owner identity.");
  }
  const metadata = {
    pid: owner.pid,
    processStartTime: owner.startTime,
    createdAt: new Date(now()).toISOString(),
    token,
  };

  try {
    await mkdirDirectory(targetPath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (process.env.RELEASE_VALIDATION_WAIT_FOR_LOCK === "1") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return acquireReleaseLock(targetPath, {
        mkdirDirectory,
        read,
        write,
        renamePath,
        remove,
        now,
        token,
        identity,
        isOwnerActive,
        reclaimPath,
      });
    }
    let existing;
    try {
      existing = JSON.parse(String(await read(ownerFile(targetPath))));
    } catch {
      throw new Error(
        "API stream release validation stopped: database isolation collision; the existing lock owner is unreadable or unverifiable.",
      );
    }
    if (
      !Number.isInteger(existing?.pid) ||
      typeof existing.processStartTime !== "string" ||
      typeof existing.token !== "string" ||
      typeof existing.createdAt !== "string"
    ) {
      throw new Error(
        "API stream release validation stopped: database isolation collision; the existing lock owner is malformed or unverifiable.",
      );
    }
    const ownerActive = await isOwnerActive(existing);
    if (ownerActive !== false) {
      throw new Error(
        ownerActive === true
          ? [
          "API stream release validation stopped: database isolation collision.",
          `Another release worker or artifact path already holds ${targetPath}.`,
          "Do not run duplicate API artifact copies against the same DATABASE_URL; serialize the release check or isolate its database.",
            ].join("\n")
          : "API stream release validation stopped: database isolation collision; the existing lock owner is unverifiable.",
      );
    }
    try {
      await renamePath(targetPath, reclaimPath);
    } catch (reclaimError) {
      if (reclaimError?.code === "ENOENT") {
        return acquireReleaseLock(targetPath, {
          mkdirDirectory,
          read,
          renamePath,
          remove,
          now,
          token,
          identity,
          isOwnerActive,
          reclaimPath,
        });
      }
      throw new Error(
        "API stream release validation stopped: database isolation collision; stale lock reclamation could not be verified.",
      );
    }
    await remove(reclaimPath, { recursive: true, force: true });
    await mkdirDirectory(targetPath);
  }

  await write(
    ownerFile(targetPath),
    JSON.stringify(metadata),
    { flag: "wx" },
  );
  let cleanedUp = false;
  return async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      const current = JSON.parse(String(await read(ownerFile(targetPath))));
      if (current.token === token) {
        await remove(targetPath, { recursive: true, force: true });
      }
    } catch {
      // Cleanup is intentionally idempotent; never remove an unverifiable lock.
    }
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log(
      "Skipping API stream release validation because DATABASE_URL is not configured; database isolation cannot be checked.",
    );
    return 0;
  }

  const actualRoot = await realpath(process.cwd());
  const expectedRoot = await realpath(artifactRoot);
  if (actualRoot !== expectedRoot) {
    console.error(
      [
        "API stream release validation stopped: duplicate artifact path detected.",
        `Expected the owning API artifact at ${expectedRoot}, but Vitest was started from ${actualRoot}.`,
        "Run the test through @workspace/api-server instead of a historical artifact copy so mutable database fixtures remain isolated.",
      ].join("\n"),
    );
    return 1;
  }

  let cleanup;
  try {
    cleanup = await acquireReleaseLock(lockPath);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  const runValidation = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "pnpm",
        ["exec", "vitest", "run", "--config", path.join(expectedRoot, "vitest.config.ts"), path.relative(expectedRoot, expectedTest), "--pool", "forks"],
        { cwd: expectedRoot, env: { ...process.env, NODE_ENV: "test" }, stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) {
          console.error(`API stream release validation stopped by ${signal}.`);
          resolve(1);
        } else resolve(code ?? 1);
      });
    });
  let exitCode = await runValidation();
  if (exitCode !== 0) {
    console.error("API stream release validation retrying once after a bounded fixture race.");
    exitCode = await runValidation();
  }
  await cleanup();
  if (exitCode !== 0) {
    console.error("API stream release validation failed; inspect the test output for a fixture or database-isolation failure.");
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}