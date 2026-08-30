#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireReleaseLock,
  lockPath,
} from "./run-release-ai-stream.mjs";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestConfig = path.join(artifactRoot, "vitest.config.ts");
// Keep every suite that writes shared AI fixture state in this repeated run.
// The explicit owning-artifact paths and release lock make this a useful
// collision check rather than a second, potentially racy test invocation.
const credentialFixtureTests = [
  path.join(artifactRoot, "src", "routes", "ai.test.ts"),
  path.join(artifactRoot, "src", "routes", "ai-stream-integration.test.ts"),
  path.join(artifactRoot, "src", "routes", "git.test.ts"),
];

function runVitest() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        vitestConfig,
        ...credentialFixtureTests,
        "--pool",
        "forks",
        "--no-file-parallelism",
        "--maxWorkers",
        "1",
      ],
      {
        cwd: artifactRoot,
        env: { ...process.env, NODE_ENV: "test" },
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`API fixture collision validation stopped by ${signal}.`);
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log(
      "Skipping API fixture collision validation because DATABASE_URL is not configured; repeated database-backed runs cannot be checked.",
    );
    return 0;
  }

  const actualRoot = await realpath(process.cwd());
  const expectedRoot = await realpath(artifactRoot);
  if (actualRoot !== expectedRoot) {
    console.error(
      [
        "API fixture collision validation stopped: duplicate artifact path detected.",
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

  let exitCode = 0;
  try {
    for (let run = 1; run <= 2; run += 1) {
      console.log(`API fixture collision validation run ${run}/2`);
      exitCode = await runVitest();
      if (exitCode !== 0) break;
    }
  } finally {
    await cleanup();
  }

  if (exitCode !== 0) {
    console.error(
      "API fixture collision validation failed; repeated route-suite runs exposed a fixture or database-isolation failure.",
    );
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}