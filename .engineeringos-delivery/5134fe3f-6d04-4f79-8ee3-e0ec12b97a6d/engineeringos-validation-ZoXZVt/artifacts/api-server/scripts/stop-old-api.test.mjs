import assert from "node:assert/strict";
import test from "node:test";
import { stopOldApi } from "./stop-old-api.mjs";

function procFixture(entries) {
  const files = new Map();
  for (const [pid, { cmdline, cwd }] of Object.entries(entries)) {
    files.set(`/proc/${pid}/cmdline`, Buffer.from(`${cmdline.join("\0")}\0`));
    files.set(`/proc/${pid}/cwd`, cwd);
  }
  return {
    list: async () => Object.keys(entries),
    read: async (file) => {
      if (!files.has(file)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return files.get(file);
    },
    resolvePath: async (file) => file === "/api-server" ? file : files.get(file),
  };
}

test("stops only a stale API process in this artifact", async () => {
  const fixture = procFixture({
    101: {
      cmdline: ["/usr/bin/node", "--enable-source-maps", "./dist/index.mjs"],
      cwd: "/api-server",
    },
    202: {
      cmdline: ["/usr/bin/node", "--enable-source-maps", "./dist/index.mjs"],
      cwd: "/other-project",
    },
    303: { cmdline: ["/usr/bin/node", "worker.mjs"], cwd: "/api-server" },
  });
  const signals = [];
  const alive = new Set([101]);
  const kill = (pid, signal) => {
    if (signal === 0) {
      if (!alive.has(pid)) {
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      }
      return;
    }
    signals.push([pid, signal]);
    alive.delete(pid);
  };

  const stopped = await stopOldApi({
    procRoot: "/proc",
    currentPid: 999,
    apiDir: "/api-server",
    list: fixture.list,
    read: fixture.read,
    resolvePath: fixture.resolvePath,
    kill,
    timeoutMs: 100,
    sleep: async () => {},
  });

  assert.deepEqual(stopped, [101]);
  assert.deepEqual(signals, [[101, "SIGTERM"]]);
});

test("waits for a stale API process to exit before returning", async () => {
  const fixture = procFixture({
    404: {
      cmdline: ["/usr/bin/node", "--enable-source-maps", "./dist/index.mjs"],
      cwd: "/api-server",
    },
  });
  const signals = [];
  let probes = 0;
  const kill = (pid, signal) => {
    if (signal === 0) {
      probes += 1;
      if (probes >= 3) {
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      }
      return;
    }
    signals.push([pid, signal]);
  };

  await stopOldApi({
    procRoot: "/proc",
    currentPid: 999,
    apiDir: "/api-server",
    list: fixture.list,
    read: fixture.read,
    resolvePath: fixture.resolvePath,
    kill,
    timeoutMs: 100,
    intervalMs: 1,
    sleep: async () => {},
  });

  assert.ok(probes >= 3);
  assert.deepEqual(signals, [[404, "SIGTERM"]]);
});