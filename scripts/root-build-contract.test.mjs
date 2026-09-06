import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const dashboard = join(root, "artifacts", "dashboard");
const mockup = join(root, "artifacts", "mockup-sandbox");

function cleanWorkflowEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of [
    "PORT",
    "BASE_PATH",
    "BUILD_PORT",
    "BUILD_BASE_PATH",
    "API_PROXY_TARGET",
    "VITE_CLERK_PUBLISHABLE_KEY",
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "REPL_ID",
  ]) {
    if (!(key in overrides)) delete env[key];
  }
  return env;
}

function runPnpm(args, { cwd = root, env = cleanWorkflowEnvironment() } = {}) {
  return spawnSync("pnpm", args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function failureText(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function assertFailsWith(result, expected) {
  assert.notEqual(result.status, 0, failureText(result));
  assert.match(failureText(result), expected);
}

async function browserJavaScript(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.name.endsWith(".js")) files.push(fullPath);
    }
  }
  await visit(directory);
  return Promise.all(files.map((file) => readFile(file, "utf8"))).then((chunks) =>
    chunks.join("\n"),
  );
}

test("root build works without workflow variables", () => {
  const result = runPnpm(["run", "build"]);
  assert.equal(result.status, 0, failureText(result));
});

test("Dashboard build embeds only the public Clerk override", async () => {
  const publicKey = "pk_test_build_contract_public";
  const serverSecret = "server_secret_must_not_reach_browser";
  const result = runPnpm(
    ["run", "build"],
    {
      cwd: dashboard,
      env: cleanWorkflowEnvironment({
        BUILD_PORT: "4183",
        BUILD_BASE_PATH: "/dashboard-contract/",
        VITE_CLERK_PUBLISHABLE_KEY: publicKey,
        CLERK_SECRET_KEY: serverSecret,
      }),
    },
  );
  assert.equal(result.status, 0, failureText(result));

  const index = await readFile(join(dashboard, "dist", "public", "index.html"), "utf8");
  const javascript = await browserJavaScript(join(dashboard, "dist", "public"));
  assert.match(index, /\/dashboard-contract\//);
  assert.match(javascript, new RegExp(publicKey));
  assert.doesNotMatch(javascript, /CLERK_SECRET_KEY/);
  assert.doesNotMatch(javascript, new RegExp(serverSecret));
});

test("runtime commands remain fail-fast when required variables are absent", () => {
  for (const [name, cwd] of [
    ["Dashboard", dashboard],
    ["mockup sandbox", mockup],
  ]) {
    for (const command of ["dev", "preview"]) {
      const missingPort = runPnpm(
        ["exec", "vite", command === "dev" ? "--config" : "preview", ...(command === "dev" ? ["vite.config.ts"] : ["--config", "vite.config.ts"])],
        { cwd, env: cleanWorkflowEnvironment() },
      );
      assertFailsWith(
        missingPort,
        /PORT environment variable is required but was not provided/,
      );

      const missingBase = runPnpm(
        ["exec", "vite", ...(command === "dev" ? [] : ["preview"]), "--config", "vite.config.ts"],
        {
          cwd,
          env: cleanWorkflowEnvironment({ PORT: "4191" }),
        },
      );
      assertFailsWith(
        missingBase,
        /BASE_PATH environment variable is required but was not provided/,
      );
    }

    if (name === "Dashboard") {
      const missingClerk = runPnpm(
        ["exec", "vite", "--config", "vite.config.ts"],
        {
          cwd,
          env: cleanWorkflowEnvironment({
            PORT: "4192",
            BASE_PATH: "/dashboard/",
          }),
        },
      );
      assertFailsWith(missingClerk, /Clerk public configuration is missing/);
    }
  }
});