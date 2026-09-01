import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

async function runProcessRecovery({
  receiptPath,
  binDirectory,
  timeoutMs,
  fixtureScript,
  partialTeardownKey,
}) {
  const fakePnpmPath = path.join(binDirectory, "pnpm");
  await mkdir(binDirectory, { recursive: true });
  await writeFile(fakePnpmPath, fixtureScript, {
    encoding: "utf8",
    mode: 0o755,
  });
  await chmod(fakePnpmPath, 0o755);

  return new Promise((resolve, reject) => {
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
        ...(timeoutMs === undefined
          ? {}
          : { RELEASE_PROCESS_RECOVERY_TIMEOUT_MS: String(timeoutMs) }),
        ...(partialTeardownKey === undefined
          ? {}
          : { PARTIAL_TEARDOWN_KEY: partialTeardownKey }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    childProcess.once("error", reject);
    childProcess.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

test("process-recovery script keeps the last passing receipt on skipped runs", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "process-recovery-receipt-test-"),
  );
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
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "process-recovery-receipt-test-"),
  );
  const binDirectory = path.join(directory, "bin");
  const receiptPath = path.join(directory, "receipt.json");
  const previous = JSON.stringify({ kind: "previous-pass", revision: "old" });
  await writeFile(receiptPath, previous, "utf8");
  try {
    const child = await runProcessRecovery({
      receiptPath,
      binDirectory,
      fixtureScript: "#!/bin/sh\nexit 17\n",
    });
    assert.deepEqual(child, { code: 17, signal: null });
    assert.equal(await readFile(receiptPath, "utf8"), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process-recovery script keeps the last passing receipt when the child times out", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "process-recovery-receipt-test-"),
  );
  const receiptPath = path.join(directory, "receipt.json");
  const previous = JSON.stringify({ kind: "previous-pass", revision: "old" });
  await writeFile(receiptPath, previous, "utf8");
  try {
    const child = await runProcessRecovery({
      receiptPath,
      binDirectory: path.join(directory, "bin"),
      timeoutMs: 100,
      fixtureScript: "#!/bin/sh\nsleep 30\n",
    });
    assert.deepEqual(child, { code: 1, signal: null });
    assert.equal(await readFile(receiptPath, "utf8"), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process-recovery script rejects partial teardown evidence without changing the last passing receipt", async () => {
  const partialTeardownCases = [
    ["surviving listener", "listener"],
    ["surviving child", "child"],
    ["surviving root", "root"],
    ["surviving project", "project"],
  ];
  const fixtureScript = `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const teardown = {
  disposableProjectRetired: true,
  generatedRootRetired: true,
  apiDescendantsSurviving: false,
  recoveryListenerOccupied: false,
  secretsRetained: false,
};
const key = process.env.PARTIAL_TEARDOWN_KEY;
if (key === "listener") teardown.recoveryListenerOccupied = true;
if (key === "child") teardown.apiDescendantsSurviving = true;
if (key === "root") teardown.generatedRootRetired = false;
if (key === "project") teardown.disposableProjectRetired = false;
writeFileSync(process.env.LIVE_RECOVERY_RESULT_PATH, JSON.stringify({
  provider: { id: "gemini", model: "fixture-model", supportsTools: false },
  milestones: {
    initialHealth: "passed",
    checkpointPersistedBeforeStop: "passed",
    checkpointSequence: "non-zero",
    firstProcessStopped: "passed",
    restartHealthyWithinBound: "passed",
    sameExecutionResumedWithOriginalResumeIdentity: "passed",
    forensicResponse: "successful",
    expectedSourcePath: "src/process-recovery.ts",
    writeOperations: "none",
    sourceBytesUnchanged: true
  },
  teardown,
  diagnostics: "fixture diagnostic must never reach the receipt",
  credential: "fixture credential must never reach the receipt"
}));
`;

  for (const [description, partialTeardownKey] of partialTeardownCases) {
    await testPartialTeardownCase({
      description,
      partialTeardownKey,
      fixtureScript,
    });
  }
});

async function testPartialTeardownCase({
  description,
  partialTeardownKey,
  fixtureScript,
}) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "process-recovery-receipt-test-"),
  );
  const receiptPath = path.join(directory, "receipt.json");
  const previous = JSON.stringify({ kind: "previous-pass", revision: "old" });
  await writeFile(receiptPath, previous, "utf8");
  try {
    const child = await runProcessRecovery({
      receiptPath,
      binDirectory: path.join(directory, "bin"),
      partialTeardownKey,
      fixtureScript,
    });
    assert.deepEqual(child, { code: 1, signal: null }, description);
    const receipt = await readFile(receiptPath, "utf8");
    assert.equal(
      receipt,
      previous,
      `${description} must not replace the passing receipt`,
    );
    assert.doesNotMatch(receipt, /fixture diagnostic|fixture credential/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
