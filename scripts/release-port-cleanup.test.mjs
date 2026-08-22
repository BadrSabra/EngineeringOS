import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    ["-e", "require('net').createServer().listen(Number(process.argv[1]), '127.0.0.1')", String(port)],
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

test("release port cleanup supports consecutive runs", async () => {
  const port = 30_000 + Math.floor(Math.random() * 2_000);
  const first = await startListener(port);
  await runCleanup(port);
  first.kill("SIGTERM");

  const second = await startListener(port);
  await runCleanup(port);
  second.kill("SIGTERM");

  await runCleanup(port);
  assert.ok(true, "a second cleanup run must remain successful after the listener is gone");
});
