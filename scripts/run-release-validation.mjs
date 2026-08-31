#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireReleaseLock,
  validationLockPath,
} from "../artifacts/api-server/scripts/run-release-ai-stream.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function buildValidationEnv() {
  const env = { ...process.env };
  if (!env.AI_CREDENTIALS_ENCRYPTION_KEY) {
    try {
      const persistedKey = (await readFile(
        path.join(workspaceRoot, ".local", "encryption.key"),
        "utf8",
      )).trim();
      if (/^[0-9a-f]{64}$/i.test(persistedKey)) {
        env.AI_CREDENTIALS_ENCRYPTION_KEY = persistedKey;
      }
    } catch {
      // The API startup migration reports a clear warning when no key can be
      // loaded or generated. Keep release validation's existing behavior when
      // neither an environment nor persisted key is available.
    }
  }
  return env;
}

const validationEnv = await buildValidationEnv();

if (!process.env.DATABASE_URL) {
  const child = spawn("pnpm", ["run", "validate:release"], {
    cwd: workspaceRoot,
    env: validationEnv,
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => {
    process.exit(signal ? 1 : code ?? 1);
  });
} else {
  let cleanup;
  try {
    cleanup = await acquireReleaseLock(validationLockPath);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }

  const child = spawn("pnpm", ["run", "validate:release"], {
    cwd: workspaceRoot,
    env: validationEnv,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  await cleanup();
  process.exit(exitCode);
}