#!/usr/bin/env node

import { spawn } from "node:child_process";

const requiredEnvironment = ["DATABASE_URL", "OPENROUTER_API_KEY"];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
  console.error(
    `Real process-recovery validation requires provider/database configuration: ${missingEnvironment.join(", ")}.`,
  );
  console.error(
    "This check is intentionally opt-in; run it only in a controlled release-validation environment.",
  );
  process.exit(2);
}

const secretValues = Object.values(process.env).filter(
  (value) => typeof value === "string" && value.length >= 8,
);

function redact(value) {
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value,
  );
}

const child = spawn(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "src/routes/ai-stream-integration.test.ts",
    "-t",
    "recovers a forensic stream after the API process exits",
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      RUN_REAL_API_PROCESS_RECOVERY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk.toString("utf8"))));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk.toString("utf8"))));

child.on("error", (error) => {
  console.error(`Unable to start real process-recovery validation: ${redact(error.message)}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Real process-recovery validation stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    console.error(`Real process-recovery validation failed (exit code ${code ?? "unknown"}).`);
    process.exitCode = code ?? 1;
    return;
  }
  console.log("Real process-recovery validation completed successfully.");
  process.exitCode = 0;
});