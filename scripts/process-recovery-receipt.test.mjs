import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(
  workspaceRoot,
  "artifacts/api-server/scripts/run-real-process-recovery.mjs",
);

test("process-recovery script keeps the last passing receipt on skipped runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "process-recovery-receipt-test-"));
  const receiptPath = path.join(directory, "receipt.json");
  const previous = JSON.stringify({ kind: "previous-pass", revision: "old" });
  await writeFile(receiptPath, previous, "utf8");
  try {
    const child = await new Promise((resolve) => {
      const childProcess = spawn(process.execPath, [scriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          RUN_REAL_API_PROCESS_RECOVERY: undefined,
          LIVE_RECOVERY_RECEIPT_PATH: receiptPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      childProcess.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(child, { code: 0, signal: null });
    assert.equal(await readFile(receiptPath, "utf8"), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process-recovery script keeps the last passing receipt on failed runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "process-recovery-receipt-test-"));
  const binDirectory = path.join(directory, "bin");
  const receiptPath = path.join(directory, "receipt.json");
  const fakePnpmPath = path.join(binDirectory, "pnpm");
  const previous = JSON.stringify({ kind: "previous-pass", revision: "old" });
  await writeFile(receiptPath, previous, "utf8");
  await mkdir(binDirectory, { recursive: true });
  await writeFile(fakePnpmPath, "#!/bin/sh\nexit 17\n", { encoding: "utf8", mode: 0o755 });
  await chmod(fakePnpmPath, 0o755);
  try {
    const child = await new Promise((resolve) => {
      const childProcess = spawn(process.execPath, [scriptPath], {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
          RUN_REAL_API_PROCESS_RECOVERY: "1",
          LIVE_RECOVERY_PROVIDER: "gemini",
          DATABASE_URL: "fixture-database-url",
          GEMINI_API_KEY: "fixture-provider-key",
          LIVE_RECOVERY_RECEIPT_PATH: receiptPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      childProcess.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(child, { code: 17, signal: null });
    assert.equal(await readFile(receiptPath, "utf8"), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});