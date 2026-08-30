#!/usr/bin/env node

import { spawn } from "node:child_process";
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

if (!process.env.DATABASE_URL) {
  const child = spawn("pnpm", ["run", "validate:release"], {
    cwd: workspaceRoot,
    env: process.env,
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
    env: process.env,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  await cleanup();
  process.exit(exitCode);
}