import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  findOwnedRuntimeProcessGroups,
  stopOwnedRuntimeProcessGroup,
} from "./owned-runtime-cleanup.mjs";

const workspaceRoot = resolve(new URL("..", import.meta.url).pathname);
const resultsRoot = resolve(workspaceRoot, "test-results");

async function makeRoot() {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(resultsRoot, { recursive: true }));
  const root = await mkdtemp(join(resultsRoot, ".runtime-cleanup-"));
  const actual = await realpath(root);
  assert.ok(actual.startsWith(`${await realpath(resultsRoot)}/`));
  return actual;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function portIsOpen(port) {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.destroy();
      resolveResult(result);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function startGroup(root, { port, stubborn = false } = {}) {
  const childServer = [
    "const net=require('node:net');",
    "const server=net.createServer();",
    "server.listen(Number(process.env.RUNTIME_TEST_PORT),'127.0.0.1');",
    ...(stubborn ? ["process.on('SIGTERM',()=>{});"] : []),
    "setInterval(()=>{},1000);",
  ].join("");
  const parentScript = stubborn
    ? [
        "const {spawn}=require('node:child_process');",
        `spawn(process.execPath,['-e',${JSON.stringify(childServer)}],{cwd:process.cwd(),env:process.env,stdio:'ignore'});`,
        "setInterval(()=>{},1000);",
      ].join("")
    : childServer;
  const child = spawn(process.execPath, ["-e", parentScript], {
    cwd: root,
    env: { ...process.env, RUNTIME_TEST_PORT: String(port) },
    detached: true,
    stdio: "ignore",
  });
  assert.ok(child.pid);
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && !(await portIsOpen(port))) {
    if (child.exitCode !== null) throw new Error("Runtime lifecycle fixture exited before it listened.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.equal(await portIsOpen(port), true, "runtime fixture must listen only on loopback");
  return { pid: child.pid, child };
}

async function removeRoot(root) {
  await rm(root, { recursive: true, force: true });
  await assert.rejects(stat(root), { code: "ENOENT" });
}

test("runtime group stops after successful test and removes its isolated files", async () => {
  const root = await makeRoot();
  const port = await reserveLoopbackPort();
  const runtime = await startGroup(root, { port });
  try {
    const cleanup = await stopOwnedRuntimeProcessGroup({
      pid: runtime.pid,
      projectRoot: root,
    });
    assert.deepEqual(cleanup.remainingPids, []);
    assert.equal(await portIsOpen(port), false);
  } finally {
    await stopOwnedRuntimeProcessGroup({ pid: runtime.pid, projectRoot: root }).catch(() => {});
    await removeRoot(root);
  }
});

test("runtime group stops in finally after a test failure", async () => {
  const root = await makeRoot();
  const port = await reserveLoopbackPort();
  let runtime;
  try {
    await assert.rejects(async () => {
      try {
        runtime = await startGroup(root, { port });
        throw new Error("controlled test failure");
      } finally {
        if (runtime) {
          await stopOwnedRuntimeProcessGroup({ pid: runtime.pid, projectRoot: root });
        }
      }
    }, /controlled test failure/u);
    assert.equal(await portIsOpen(port), false);
  } finally {
    if (runtime) {
      await stopOwnedRuntimeProcessGroup({ pid: runtime.pid, projectRoot: root }).catch(() => {});
    }
    await removeRoot(root);
  }
});

test("runtime group stops in finally after a bounded test timeout", async () => {
  const root = await makeRoot();
  const port = await reserveLoopbackPort();
  let runtime;
  try {
    await assert.rejects(async () => {
      try {
        runtime = await startGroup(root, { port });
        await new Promise((_, reject) => setTimeout(
          () => reject(new Error("controlled test timeout")),
          50,
        ));
      } finally {
        if (runtime) {
          await stopOwnedRuntimeProcessGroup({ pid: runtime.pid, projectRoot: root });
        }
      }
    }, /controlled test timeout/u);
    assert.equal(await portIsOpen(port), false);
  } finally {
    if (runtime) {
      await stopOwnedRuntimeProcessGroup({ pid: runtime.pid, projectRoot: root }).catch(() => {});
    }
    await removeRoot(root);
  }
});

test("cleanup escalates only within the owned process group and leaves unrelated listeners alive", async () => {
  const root = await makeRoot();
  const unrelatedRoot = await makeRoot();
  const ownedPort = await reserveLoopbackPort();
  const unrelatedPort = await reserveLoopbackPort();
  let owned;
  let unrelated;
  try {
    owned = await startGroup(root, { port: ownedPort, stubborn: true });
    unrelated = await startGroup(unrelatedRoot, { port: unrelatedPort });
    const discoveredGroups = await findOwnedRuntimeProcessGroups(root);
    assert.equal(discoveredGroups.length, 1);
    assert.equal(discoveredGroups[0].processGroupId, owned.pid);
    assert.ok(discoveredGroups[0].pids.length >= 2, "cleanup discovery includes the child runtime process");
    const cleanup = await stopOwnedRuntimeProcessGroup({
      pid: owned.pid,
      projectRoot: root,
      gracefulTimeoutMs: 100,
      escalationTimeoutMs: 1_000,
    });
    assert.ok(cleanup.forcedPids.length > 0, "the stubborn descendant requires bounded escalation");
    assert.equal(await portIsOpen(ownedPort), false);
    assert.equal(await portIsOpen(unrelatedPort), true);
    assert.equal(process.kill(unrelated.pid, 0), true);
  } finally {
    if (owned) {
      await stopOwnedRuntimeProcessGroup({ pid: owned.pid, projectRoot: root }).catch(() => {});
    }
    if (unrelated) {
      await stopOwnedRuntimeProcessGroup({ pid: unrelated.pid, projectRoot: unrelatedRoot }).catch(() => {});
    }
    await removeRoot(root);
    await removeRoot(unrelatedRoot);
  }
});
