import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFile = promisify((await import("node:child_process")).execFile);
const guardPath = fileURLToPath(new URL("./runtime-egress-guard.mjs", import.meta.url));
const testEnvironment = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  NODE_ENV: "test",
  NODE_OPTIONS: "",
};

test("runtime guard blocks external fetch, socket, HTTP, DNS, UDP, and public listeners before network access", async () => {
  const source = `
    import assert from "node:assert/strict";
    import dgram from "node:dgram";
    import dns from "node:dns";
    import http2 from "node:http2";
    import http from "node:http";
    import net from "node:net";
    import { once } from "node:events";
    assert.equal(globalThis[Symbol.for("engineeringos.runtime-egress-guard")]?.installed, true);
    assert.throws(() => fetch("https://api.openrouter.ai/models"), /egress blocked/u);
    assert.throws(() => net.connect({ host: "api.clerk.com", port: 443 }), /egress blocked/u);
    assert.throws(() => http.request("https://api.github.com/repos"), /egress blocked/u);
    assert.throws(() => dns.lookup("api.openrouter.ai", () => {}), /egress blocked/u);
    const localLookup = await new Promise((resolve, reject) => {
      dns.lookup("localhost", (error, address) => error ? reject(error) : resolve(address));
    });
    assert.equal(localLookup, "127.0.0.1");
    const localPromiseLookup = await dns.promises.lookup("localhost");
    assert.equal(localPromiseLookup.address, "127.0.0.1");
    assert.throws(() => dns.resolve4("api.openrouter.ai", () => {}), /egress blocked/u);
    assert.throws(() => dns.resolve4("127.0.0.1", () => {}), /egress blocked/u);
    assert.throws(() => dns.promises.resolve4("api.openrouter.ai"), /egress blocked/u);
    assert.throws(() => new dns.Resolver().resolve4("api.openrouter.ai", () => {}), /egress blocked/u);
    assert.throws(() => http2.connect("https://api.github.com"), /egress blocked/u);
    const udp = dgram.createSocket("udp4");
    assert.throws(() => udp.send(Buffer.from("x"), 53, "example.com"), /egress blocked/u);
    assert.throws(() => udp.connect(53, "example.com"), /egress blocked/u);
    udp.close();
    const childProcess = await import("node:child_process");
    assert.throws(
      () => childProcess.spawn("curl", ["https://api.clerk.com"]),
      /child-process policy blocked|child-process creation/u,
    );
    const publicServer = net.createServer();
    assert.throws(() => publicServer.listen(0, "0.0.0.0"), /egress blocked/u);
    const defaultBoundServer = net.createServer();
    assert.throws(() => defaultBoundServer.listen(0), /egress blocked/u);
    const localServer = net.createServer();
    localServer.listen(0, "127.0.0.1");
    await once(localServer, "listening");
    const address = localServer.address();
    assert.equal(address.address, "127.0.0.1");
    await new Promise((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
    console.log("runtime-egress-guard=active");
  `;
  const child = spawn(process.execPath, ["--import", guardPath, "--input-type=module", "-e", source], {
    env: testEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.match(stdout, /runtime-egress-guard=active/u);
});

test("runtime guard records its installation against the exact child PID", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "engineeringos-egress-audit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const auditPath = join(directory, "api-egress-audit.jsonl");
  const child = spawn(
    process.execPath,
    ["--import", guardPath, "--input-type=module", "-e", "console.log('guard-ready')"],
    {
      env: {
        ...testEnvironment,
        ENGINEERINGOS_RUNTIME_EGRESS_AUDIT_PATH: auditPath,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const childPid = child.pid;
  assert.ok(childPid);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  const events = (await readFile(auditPath, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) =>
    event.kind === "guard-installed"
    && event.pid === childPid
    && event.nodeNetworkGuard === true
    && event.childProcessPolicy === true,
  ));
});

test("runtime guard allows only loopback fetches without reaching an external host", async () => {
  const server = createServer((_request, response) => {
    response.end("local");
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.once("listening", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const { stdout } = await execFile(process.execPath, [
      "--import", guardPath,
      "--input-type=module",
      "-e",
      `const response=await fetch(${JSON.stringify(`http://127.0.0.1:${address.port}/`)}); console.log(await response.text());`,
    ], {
      env: testEnvironment,
      timeout: 5_000,
    });
    assert.equal(stdout.trim(), "local");
  } finally {
    await new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    });
  }
});
