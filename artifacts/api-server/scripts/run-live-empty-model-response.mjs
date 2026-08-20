#!/usr/bin/env node

import { spawn } from "node:child_process";

const requiredEnvironment = [
  "DATABASE_URL",
  "EMPTY_MODEL_RESPONSE_TEST_MODEL",
];
const provider = process.env.EMPTY_MODEL_RESPONSE_TEST_PROVIDER ?? "openrouter";
const providerKeyEnvironment = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
};
const providerKeyEnvironmentName = providerKeyEnvironment[provider];

if (!providerKeyEnvironmentName) {
  console.error(
    `Unsupported empty-model-response provider "${provider}". Choose openrouter or gemini.`,
  );
  process.exit(2);
}

requiredEnvironment.push(providerKeyEnvironmentName);
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (process.env.RUN_LIVE_EMPTY_MODEL_RESPONSE !== "1") {
  console.error(
    "Live empty-model-response validation is opt-in. Set RUN_LIVE_EMPTY_MODEL_RESPONSE=1.",
  );
  process.exit(2);
}

if (missingEnvironment.length > 0) {
  console.error(
    `Live empty-model-response validation requires provider/database configuration: ${missingEnvironment.join(", ")}.`,
  );
  console.error(
    "Set EMPTY_MODEL_RESPONSE_TEST_PROVIDER and EMPTY_MODEL_RESPONSE_TEST_MODEL to a documented provider/model used for the controlled empty-response scenario.",
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
    "src/routes/empty-model-response-live.test.ts",
    "-t",
    "live provider returns an empty final response",
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      RUN_LIVE_EMPTY_MODEL_RESPONSE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (chunk) => process.stdout.write(redact(chunk.toString("utf8"))));
child.stderr.on("data", (chunk) => process.stderr.write(redact(chunk.toString("utf8"))));

child.on("error", (error) => {
  console.error(`Unable to start live empty-model-response validation: ${redact(error.message)}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Live empty-model-response validation stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    console.error(`Live empty-model-response validation failed (exit code ${code ?? "unknown"}).`);
    process.exitCode = code ?? 1;
    return;
  }
  console.log("Live empty-model-response validation completed successfully.");
  process.exitCode = 0;
});