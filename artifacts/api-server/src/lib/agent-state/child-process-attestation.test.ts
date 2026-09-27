import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  attestChildProcessEnvironment,
  attestValidatorProcessTreeEnvironment,
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

async function startWrapper(root: string, marker: string, descendantNodeEnv = "development"): Promise<ChildProcess> {
  const script = [
    "const {spawn}=require('node:child_process');",
    `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:${JSON.stringify(root)},env:{...process.env,NODE_ENV:${JSON.stringify(descendantNodeEnv)}},stdio:'ignore'});`,
    "process.on('SIGTERM',()=>{child.kill('SIGTERM');process.exit(0)});",
    "setInterval(()=>{},1000);",
  ].join("");
  const wrapper = spawn(process.execPath, ["-e", script], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? root,
      NODE_ENV: "development",
      PORT: "3221",
      BASE_PATH: "/",
      [CHILD_ATTESTATION_ENV_NAME]: marker,
    },
    stdio: "ignore",
  });
  children.push(wrapper);
  await new Promise<void>((resolve, reject) => {
    wrapper.once("spawn", () => resolve());
    wrapper.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return wrapper;
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

const treeBinding: ChildProcessAttestationBinding = {
  ...binding,
  processRole: "validator_tree",
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

  it("attests a stable live wrapper tree without exposing process identifiers", async () => {
    const root = await makeRoot();
    const marker = "tree-marker-known-7b2d";
    const wrapper = await startWrapper(root, marker);
    const attestation = await attestValidatorProcessTreeEnvironment({
      pid: wrapper.pid,
      projectRoot: root,
      marker,
      binding: treeBinding,
      expectedEnvironment: { NODE_ENV: "development", PORT: "3221", BASE_PATH: "/" },
    });

    expect(attestation.status).toBe("known");
    expect(attestation.reasonCode).toBe("process_tree_observed");
    expect(attestation.visibleProcessCount).toBeGreaterThanOrEqual(2);
    expect(attestation.treeDigest).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(attestation);
    expect(serialized).not.toContain(String(wrapper.pid));
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(marker);
  });

  it("returns mismatch when a visible descendant has a different environment", async () => {
    const root = await makeRoot();
    const marker = "tree-marker-mismatch-19f4";
    const wrapper = await startWrapper(root, marker, "production");
    const attestation = await attestValidatorProcessTreeEnvironment({
      pid: wrapper.pid,
      projectRoot: root,
      marker,
      binding: treeBinding,
      expectedEnvironment: { NODE_ENV: "development" },
    });
    expect(attestation.status).toBe("mismatch");
    expect(attestation.reasonCode).toBe("child_environment_mismatch");
  });

  it("keeps a missing process and a process without descendants unknown", async () => {
    const root = await makeRoot();
    const missing = await attestValidatorProcessTreeEnvironment({
      pid: 2_147_483_647,
      projectRoot: root,
      marker: "tree-marker-missing-54c1",
      binding: treeBinding,
    });
    const child = await startChild(root, "tree-marker-no-descendant-31aa");
    const noDescendant = await attestValidatorProcessTreeEnvironment({
      pid: child.pid,
      projectRoot: root,
      marker: "tree-marker-no-descendant-31aa",
      binding: treeBinding,
    });
    expect(missing.status).toBe("unknown");
    expect(noDescendant.status).toBe("unknown");
    expect(noDescendant.reasonCode).toBe("process_tree_descendant_unavailable");
  });
});