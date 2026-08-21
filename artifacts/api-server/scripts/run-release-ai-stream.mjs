#!/usr/bin/env node

import { mkdir, rm, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedTest = path.join(
  artifactRoot,
  "src",
  "routes",
  "ai-stream-integration.test.ts",
);
const lockPath = path.join(
  process.env.TMPDIR || "/tmp",
  "engineeringos-api-stream-release.lock",
);

if (!process.env.DATABASE_URL) {
  console.log(
    "Skipping API stream release validation because DATABASE_URL is not configured; database isolation cannot be checked.",
  );
  process.exit(0);
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
  process.exit(1);
}

try {
  await mkdir(lockPath);
} catch (error) {
  if (error?.code === "EEXIST") {
    console.error(
      [
        "API stream release validation stopped: database isolation collision.",
        `Another release worker or artifact path already holds ${lockPath}.`,
        "Do not run duplicate API artifact copies against the same DATABASE_URL; serialize the release check or isolate its database.",
      ].join("\n"),
    );
    process.exit(1);
  }
  throw error;
}

let cleanedUp = false;
const cleanup = async () => {
  if (!cleanedUp) {
    cleanedUp = true;
    await rm(lockPath, { recursive: true, force: true });
  }
};
process.once("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
process.once("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    path.join(expectedRoot, "vitest.config.ts"),
    path.relative(expectedRoot, expectedTest),
    "--pool",
    "forks",
  ],
  {
    cwd: expectedRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`API stream release validation stopped by ${signal}.`);
      resolve(1);
    } else {
      resolve(code ?? 1);
    }
  });
});

await cleanup();
if (exitCode !== 0) {
  console.error(
    "API stream release validation failed; inspect the test output for a fixture or database-isolation failure.",
  );
}
process.exit(exitCode);