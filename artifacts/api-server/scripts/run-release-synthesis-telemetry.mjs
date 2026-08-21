#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { acquireReleaseLock, lockPath } from "./run-release-ai-stream.mjs";

const checks = [
  [
    "--filter",
    "@workspace/ai-orchestrator",
    "exec",
    "vitest",
    "run",
    "src/__tests__/tool-execution-engine.test.ts",
    "-t",
    "enforces a real bounded synthesis timeout and preserves operator telemetry",
  ],
];

if (process.env.DATABASE_URL) {
  checks.push([
    "exec",
    "vitest",
    "run",
    "src/routes/ai-stream-integration.test.ts",
    "-t",
    "persists bounded synthesis timeout telemetry while keeping incomplete reports sanitized",
  ]);
} else {
  console.log(
    "Skipping API synthesis telemetry assertion because DATABASE_URL is not configured; engine validation remains provider-free.",
  );
}

let cleanup;
let exitCode = 0;
try {
  if (process.env.DATABASE_URL) cleanup = await acquireReleaseLock(lockPath);
  for (const args of checks) {
    const result = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPENROUTER_API_KEY: "",
    },
    stdio: "inherit",
    });

    if (result.error) {
      console.error(`Release synthesis telemetry validation could not start: ${result.error.message}`);
      exitCode = 1;
      break;
    }

    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  if (cleanup) await cleanup();
}

if (exitCode !== 0) process.exit(exitCode);
console.log("Release synthesis telemetry validation completed successfully.");