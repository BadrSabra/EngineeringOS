import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cleanupScript = resolve(
  root,
  "artifacts/dashboard/scripts/ensure-port-free.mjs",
);

function startListener(port) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "require('net').createServer().listen(Number(process.argv[1]), '127.0.0.1')",
      String(port),
    ],
    { stdio: "ignore" },
  );
  return new Promise((resolveChild, reject) => {
    child.once("error", reject);
    const deadline = Date.now() + 2_500;
    const poll = () => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveChild(child);
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Listener did not open port ${port}.`));
        } else {
          setTimeout(poll, 25);
        }
      });
    };
    poll();
  });
}

function runCleanup(port) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cleanupScript], {
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(new Error(`Port cleanup exited with ${signal ?? code}.`));
      } else {
        resolveRun();
      }
    });
  });
}

function runTeardownFixture(apiPort, dashboardPort) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(root, "scripts/run-dashboard-journey.mjs")],
      {
        env: {
          ...process.env,
          RUN_CONTROLLED_RELEASE_VALIDATION: "1",
          DASHBOARD_E2E_TEARDOWN_FIXTURE: "1",
          DASHBOARD_E2E_API_PORT: String(apiPort),
          DASHBOARD_E2E_PORT: String(dashboardPort),
          DATABASE_URL: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(
          new Error(
            `Teardown fixture exited with ${signal ?? code}.\n${output}`,
          ),
        );
      } else {
        resolveRun(output);
      }
    });
  });
}

test("release port cleanup supports consecutive runs", async () => {
  const port = 30_000 + Math.floor(Math.random() * 2_000);
  const first = await startListener(port);
  await runCleanup(port);
  first.kill("SIGTERM");

  const second = await startListener(port);
  await runCleanup(port);
  second.kill("SIGTERM");

  await runCleanup(port);
  assert.ok(
    true,
    "a second cleanup run must remain successful after the listener is gone",
  );
});

test("release journey teardown diagnostics identify a real surviving descendant", async () => {
  const apiPort = 30_000 + Math.floor(Math.random() * 1_000);
  const dashboardPort = apiPort + 1;
  const output = await runTeardownFixture(apiPort, dashboardPort);

  assert.match(
    output,
    new RegExp(
      `Release services surviving teardown: API release service \\(configured release port ${apiPort}; surviving process IDs: \\d+; release process group: \\d+\\)`,
    ),
  );
  assert.match(output, new RegExp(`configured release port ${apiPort}`));
  assert.match(output, /surviving process IDs: \d+/);
  assert.match(output, /release process group: \d+/);

  await runCleanup(apiPort);
});

test("release journey teardown diagnostics keep both service labels and process-group details", async () => {
  const journey = await readFile(
    resolve(root, "scripts/run-dashboard-journey.mjs"),
    "utf8",
  );

  assert.match(journey, /configured release port \$\{port\}/);
  assert.match(journey, /surviving process IDs/);
  assert.match(journey, /release process group/);
  assert.match(journey, /API release service/);
  assert.match(journey, /Dashboard release service/);
});
