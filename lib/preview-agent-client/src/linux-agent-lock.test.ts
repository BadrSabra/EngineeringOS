import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PreviewAgentLockError,
  withLinuxAgentLock,
} from "./linux-agent-lock.js";

const nodeId = "a462a6c3-e2fa-49bb-a228-3e5a61330115";

describe("Linux Preview Agent process lock", () => {
  it("allows one process per node and removes only its own lock", async () => {
    const stateDirectory = await mkdtemp(
      path.join(os.tmpdir(), "preview-agent-lock-"),
    );
    await chmod(stateDirectory, 0o700);
    try {
      await withLinuxAgentLock(
        nodeId,
        async () => {
          await expect(
            withLinuxAgentLock(nodeId, async () => undefined, {
              stateDirectory,
            }),
          ).rejects.toMatchObject({
            code: "PREVIEW_AGENT_ALREADY_RUNNING",
          });
          const locked = JSON.parse(
            await readFile(path.join(stateDirectory, `${nodeId}.lock`), "utf8"),
          );
          expect(locked.pid).toBe(process.pid);
        },
        { stateDirectory },
      );

      await expect(
        readFile(path.join(stateDirectory, `${nodeId}.lock`), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        withLinuxAgentLock(nodeId, async () => "acquired", {
          stateDirectory,
        }),
      ).resolves.toBe("acquired");
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("reclaims a lock only after proving the recorded process is stale", async () => {
    const stateDirectory = await mkdtemp(
      path.join(os.tmpdir(), "preview-agent-lock-stale-"),
    );
    await chmod(stateDirectory, 0o700);
    const lockPath = path.join(stateDirectory, `${nodeId}.lock`);
    try {
      await writeFile(
        lockPath,
        JSON.stringify({
          version: 1,
          pid: 912_345,
          processIdentity: "previous-boot:42",
          lockId: randomUUID(),
        }),
        { mode: 0o600 },
      );
      await expect(
        withLinuxAgentLock(nodeId, async () => "recovered", {
          stateDirectory,
          processIdentity: async (pid) =>
            pid === process.pid ? "current-boot:100" : null,
          isProcessAlive: (pid) => pid === process.pid,
        }),
      ).resolves.toBe("recovered");
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });

  it("does not accept a shared or invalid state directory", async () => {
    const stateDirectory = await mkdtemp(
      path.join(os.tmpdir(), "preview-agent-lock-mode-"),
    );
    try {
      await chmod(stateDirectory, 0o755);
      await expect(
        withLinuxAgentLock(nodeId, async () => undefined, { stateDirectory }),
      ).rejects.toBeInstanceOf(PreviewAgentLockError);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  });
});
