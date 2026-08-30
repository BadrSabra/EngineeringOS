import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireReleaseLock,
  lockPath as configuredLockPath,
  RELEASE_LOCK_ROOT,
} from "./run-release-ai-stream.mjs";

async function lockFixture(metadata) {
  const root = await mkdtemp(path.join(os.tmpdir(), "engineeringos-release-lock-"));
  const lockPath = path.join(root, "release.lock");
  await mkdir(lockPath);
  await writeFile(path.join(lockPath, "owner.json"), JSON.stringify(metadata));
  return { root, lockPath };
}

const owner = {
  pid: 1234,
  processStartTime: "start-1",
  createdAt: "2026-08-21T12:00:00.000Z",
  token: "owner-token",
};

test("release lock stays outside a redirected TMPDIR", () => {
  assert.equal(
    configuredLockPath,
    path.join(RELEASE_LOCK_ROOT, "engineeringos-api-stream-release.lock"),
  );
  assert.equal(RELEASE_LOCK_ROOT, "/tmp");
});

test("active release owner fails with the database-isolation collision", async () => {
  const { root, lockPath } = await lockFixture(owner);
  try {
    await assert.rejects(
      acquireReleaseLock(lockPath, {
        identity: async () => ({ pid: 5678, startTime: "start-new" }),
        isOwnerActive: async () => true,
        now: () => 1724241600000,
        token: "new-token",
      }),
      /database isolation collision/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")),
      owner,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("terminated release owner is reclaimed and the new owner proceeds", async () => {
  const { root, lockPath } = await lockFixture(owner);
  try {
    const cleanup = await acquireReleaseLock(lockPath, {
      identity: async () => ({ pid: 5678, startTime: "start-new" }),
      isOwnerActive: async () => false,
      now: () => 1787313600000,
      token: "new-token",
      reclaimPath: path.join(root, "reclaimed-lock"),
    });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")),
      {
        pid: 5678,
        processStartTime: "start-new",
        createdAt: "2026-08-21T12:00:00.000Z",
        token: "new-token",
      },
    );
    await cleanup();
    await assert.rejects(readFile(lockPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed release owner fails closed and remains intact", async () => {
  const { root, lockPath } = await lockFixture({ pid: 1234 });
  try {
    await assert.rejects(
      acquireReleaseLock(lockPath, {
        identity: async () => ({ pid: 5678, startTime: "start-new" }),
        isOwnerActive: async () => false,
        token: "new-token",
      }),
      /malformed or unverifiable/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")),
      { pid: 1234 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});