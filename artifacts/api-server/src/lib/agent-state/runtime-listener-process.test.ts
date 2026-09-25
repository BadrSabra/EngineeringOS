import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseListeningSocketInodes,
  resolveRuntimeListenerProcess,
} from "./runtime-listener-process.js";

const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1_000);
    timeout.unref();
  })));
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("test_port_unavailable"));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("test_listener_start_timeout");
}

function startNode(script: string, port: number): ChildProcess {
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, TEST_LISTENER_PORT: String(port) },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

describe("runtime listener process resolution", () => {
  it("parses exact IPv4 and IPv6 listening socket inodes for a port", () => {
    const table = [
      " sl local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid timeout inode",
      " 0: 0100007F:C350 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 4242",
      " 1: 00000000:C350 00000000:0000 06 00000000:00000000 00:00000000 00000000 1000 0 9999",
      " 2: 00000000000000000000000001000000:C350 00000000000000000000000000000000 0A 00000000:00000000 00:00000000 00000000 1000 0 4343",
    ].join("\n");

    expect([...parseListeningSocketInodes(table, 50_000)].sort()).toEqual(["4242", "4343"]);
  });

  it("resolves a listener only when the socket owner is inside the launch process tree", async () => {
    const port = await freePort();
    const server = startNode(
      "const net=require('node:net');const s=net.createServer();s.listen(Number(process.env.TEST_LISTENER_PORT),'127.0.0.1');setInterval(()=>{},1000);",
      port,
    );
    await waitForPort(port);

    const result = await resolveRuntimeListenerProcess({
      launchPid: server.pid,
      port,
      bindingDigest: "a".repeat(64),
    });

    expect(result).toMatchObject({
      status: "known",
      reasonCode: "listener_owned_by_runtime_process",
      port,
      pid: server.pid,
    });
    expect(result.identityDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not attribute an unrelated listener to the runtime launch process", async () => {
    const port = await freePort();
    const launch = startNode("setInterval(()=>{},1000);", port);
    const listener = startNode(
      "const net=require('node:net');const s=net.createServer();s.listen(Number(process.env.TEST_LISTENER_PORT),'127.0.0.1');setInterval(()=>{},1000);",
      port,
    );
    await waitForPort(port);

    const result = await resolveRuntimeListenerProcess({
      launchPid: launch.pid,
      port,
      bindingDigest: "b".repeat(64),
    });

    expect(result).toMatchObject({
      status: "unknown",
      reasonCode: "listener_not_in_runtime_tree",
      port: null,
      pid: null,
      identityDigest: null,
    });
    expect(listener.pid).not.toBe(launch.pid);
  });
});