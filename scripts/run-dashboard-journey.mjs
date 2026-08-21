#!/usr/bin/env node

import { spawn } from "node:child_process";

if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
  console.error(
    "Dashboard browser journey is release-only; set RUN_CONTROLLED_RELEASE_VALIDATION=1.",
  );
  process.exit(2);
}

const dashboardBaseUrl =
  process.env.DASHBOARD_E2E_BASE_URL ?? "http://127.0.0.1:23183/dashboard/";
const apiHealthUrl =
  process.env.DASHBOARD_E2E_API_HEALTH_URL ??
  "http://127.0.0.1:8080/api/healthz";
const testEmail =
  process.env.DASHBOARD_E2E_EMAIL ??
  "engineeringos-dashboard-release@example.com";
const timeoutMs = Number(
  process.env.DASHBOARD_E2E_PREFLIGHT_TIMEOUT_MS ?? 30_000,
);

function redact(value) {
  const secretValues = Object.values(process.env).filter(
    (item) => typeof item === "string" && item.length >= 8,
  );
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value,
  );
}

async function waitFor(url, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${label} did not become healthy: ${lastError} (${url})`);
}

function runClerkHandoffContracts() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn(
      "pnpm",
      ["--filter", "@workspace/dashboard", "run", "test:clerk-handoff"],
      {
        env: {
          ...process.env,
          CI: "true",
        },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start dashboard Clerk handoff contract checks: ${redact(error.message)}`,
        ),
      );
    });

    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `Dashboard Clerk handoff contract checks stopped by ${signal}.`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Dashboard Clerk handoff contract checks failed with exit code ${code ?? 1}; browser startup was skipped.`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function runConcurrentChatContractChecks() {
  return new Promise((resolve, reject) => {
    const contractTests = spawn(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "vitest",
        "run",
        "src/routes/ai.test.ts",
        "src/routes/ai-stream-integration.test.ts",
        "-t",
        "keeps the newer resumable contract when concurrent JSON turns finish out of order|keeps the newest resumable contract when same-session turns finish out of order|keeps a streamed forensic cancellation incomplete after recovery retains partial evidence",
      ],
      {
        env: {
          ...process.env,
          CI: "true",
          NODE_ENV: "test",
           GROQ_API_KEY: "",
           GEMINI_API_KEY: "",
           DEEPSEEK_API_KEY: "",
          OPENROUTER_API_KEY: "",
        },
        stdio: "inherit",
      },
    );

    contractTests.on("error", (error) => {
      reject(
        new Error(
          `Unable to start concurrent chat contract checks: ${redact(error.message)}`,
        ),
      );
    });

    contractTests.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(`Concurrent chat contract checks stopped by ${signal}.`),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Concurrent chat contract checks failed with exit code ${code ?? 1}; browser startup was skipped.`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

await runClerkHandoffContracts();
console.log("Dashboard Clerk handoff response contracts passed.");

const dashboardResponse = await waitFor(dashboardBaseUrl, "Dashboard workflow");
const dashboardHtml = await dashboardResponse.text();
if (!dashboardHtml.includes("/dashboard/")) {
  throw new Error(
    `Dashboard workflow responded without the /dashboard/ base path (${dashboardBaseUrl}).`,
  );
}

const apiResponse = await waitFor(apiHealthUrl, "API workflow");
const apiHealth = await apiResponse.json();
if (apiHealth?.status !== "ok") {
  throw new Error(
    `API health check did not report status=ok (${apiHealthUrl}).`,
  );
}

await runConcurrentChatContractChecks();
console.log("Concurrent chat continuation contracts passed.");

console.log(`Dashboard workflow healthy at ${dashboardBaseUrl}`);
console.log(`API workflow healthy at ${apiHealthUrl}`);
console.log(`Using isolated Clerk journey user ${testEmail}`);

const child = spawn(
  "pnpm",
  ["--filter", "@workspace/dashboard", "run", "test:e2e"],
  {
    env: {
      ...process.env,
      CI: "true",
      DASHBOARD_E2E_BASE_URL: dashboardBaseUrl,
      DASHBOARD_E2E_EMAIL: testEmail,
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(
    `Unable to start dashboard browser journey: ${redact(error.message)}`,
  );
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Dashboard browser journey stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
