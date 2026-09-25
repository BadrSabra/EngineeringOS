import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attestChildProcessEnvironment,
  childProcessBindingDigest,
  CHILD_ATTESTATION_ENV_NAME,
  type ChildProcessAttestationBinding,
} from "./child-process-attestation.js";

const children: ChildProcess[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.killed) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill("SIGKILL");
    await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "child-process-attestation-"));
  roots.push(root);
  return root;
}

async function startChild(root: string, marker: string, nodeEnv = "development"): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? root,
      NODE_ENV: nodeEnv,
      PORT: "3221",
      BASE_PATH: "/",
      [CHILD_ATTESTATION_ENV_NAME]: marker,
    },
    stdio: "ignore",
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  return child;
}

const binding: ChildProcessAttestationBinding = {
  projectId: "project-child-attestation",
  sessionId: "session-child-attestation",
  executionId: "execution-child-attestation",
  executionAttempt: 3,
  episodeId: "episode-child-attestation",
  operationId: "operation-child-attestation",
  revision: "revision-child-attestation",
};

describe("child process environment attestation", () => {
  it("attests the live process through procfs without returning its marker or raw environment", async () => {
    const root = await makeRoot();
    const marker = "8bdc6852-75c7-49d0-8c36-0ac146ef38d0";
    const child = await startChild(root, marker);
    const attestation = await attestChildProcessEnvironment({
      pid: child.pid,
      projectRoot: root,
      marker,
      binding,
      expectedEnvironment: { NODE_ENV: "development", PORT: "3221", BASE_PATH: "/" },
    });

    expect(attestation).toMatchObject({
      status: "known",
      reasonCode: "child_process_observed",
      bindingDigest: childProcessBindingDigest(binding),
    });
    expect(attestation.attestationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(attestation.processEnvironmentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(attestation)).not.toContain(marker);
    expect(JSON.stringify(attestation)).not.toContain(root);
  });

  it("records an explicit mismatch when the marker or expected child environment differs", async () => {
    const root = await makeRoot();
    const marker = "88d2fc93-11b2-4e5d-b6d4-4fa3de3c2b26";
    const child = await startChild(root, marker, "production");

    const markerMismatch = await attestChildProcessEnvironment({
      pid: child.pid,
      projectRoot: root,
      marker: "d79d5df7-1679-48fa-9ee4-8fd8be8e43d1",
      binding,
    });
    const environmentMismatch = await attestChildProcessEnvironment({
      pid: child.pid,
      projectRoot: root,
      marker,
      binding,
      expectedEnvironment: { NODE_ENV: "development" },
    });

    expect(markerMismatch.status).toBe("mismatch");
    expect(markerMismatch.reasonCode).toBe("child_environment_mismatch");
    expect(environmentMismatch.status).toBe("mismatch");
    expect(environmentMismatch.processEnvironmentDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps missing process evidence unknown and binds observations to the supplied execution identity", async () => {
    const missing = await attestChildProcessEnvironment({
      pid: 2_147_483_647,
      projectRoot: await makeRoot(),
      marker: "9ef09d39-6ec6-4c07-83d0-9a30cc8459bd",
      binding,
    });
    const differentBinding = childProcessBindingDigest({
      ...binding,
      executionAttempt: binding.executionAttempt + 1,
    });

    expect(missing.status).toBe("unknown");
    expect(missing.attestationDigest).toBeNull();
    expect(missing.bindingDigest).not.toBe(differentBinding);
  });
});