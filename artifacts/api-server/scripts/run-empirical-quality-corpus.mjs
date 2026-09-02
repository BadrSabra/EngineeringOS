#!/usr/bin/env node

import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.RUN_EMPIRICAL_QUALITY_CORPUS_PREFLIGHT !== "1") {
  console.error(
    "SKIP: empirical quality corpus verification is opt-in. Set RUN_EMPIRICAL_QUALITY_CORPUS_PREFLIGHT=1 to access GitHub metadata.",
  );
  process.exit(0);
}

const child = spawn(
  "pnpm",
  ["exec", "tsx", "src/lib/verify-empirical-quality-corpus.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      RUN_EMPIRICAL_QUALITY_CORPUS_PREFLIGHT: "1",
    },
    stdio: "inherit",
  },
);

const timeoutMs = Number(process.env.EMPIRICAL_QUALITY_CORPUS_PREFLIGHT_TIMEOUT_MS ?? 300_000);
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000);

child.on("error", () => {
  clearTimeout(timeout);
  console.error("Empirical quality corpus verification could not start.");
  process.exitCode = 3;
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (timedOut) {
    console.error("Empirical quality corpus verification timed out.");
    process.exitCode = 3;
    return;
  }
  process.exitCode = signal ? 3 : code ?? 3;
});