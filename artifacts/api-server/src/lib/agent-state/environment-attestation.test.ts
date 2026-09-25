import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./environment-attestation.js";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), "environment-attestation-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("server-owned environment attestation", () => {
  const profile = serverEnvironmentProfile("TASK_EXECUTION", { kind: "mission-task" });

  it("is stable for unchanged allowlisted manifests and changes with a lockfile", async () => {
    const root = await createRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const first = await captureEnvironmentAttestation({ rootPath: root, profile });
    const repeated = await captureEnvironmentAttestation({ rootPath: root, profile });
    expect(first.status).toBe("known");
    expect(repeated).toEqual(first);

    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nchanged: true\n");
    const changed = await captureEnvironmentAttestation({ rootPath: root, profile });
    expect(changed.status).toBe("known");
    if (first.status === "known" && changed.status === "known") {
      expect(changed.environmentRevision).not.toBe(first.environmentRevision);
    }
  });

  it("does not vary with .env or .npmrc contents", async () => {
    const root = await createRoot();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    await writeFile(join(root, ".env"), "PRIVATE_VALUE=first\n");
    await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=first\n");
    const first = await captureEnvironmentAttestation({ rootPath: root, profile });

    await writeFile(join(root, ".env"), "PRIVATE_VALUE=second\n");
    await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=second\n");
    const second = await captureEnvironmentAttestation({ rootPath: root, profile });

    expect(first.status).toBe("known");
    expect(second).toEqual(first);
  });

  it("fails closed for symlinked manifest files and roots without manifests", async () => {
    const linkedRoot = await createRoot();
    const externalFile = join(linkedRoot, "manifest-source");
    await writeFile(externalFile, JSON.stringify({ name: "fixture" }));
    await symlink(externalFile, join(linkedRoot, "package.json"));
    expect(await captureEnvironmentAttestation({ rootPath: linkedRoot, profile })).toEqual({
      status: "unknown",
      reason: "manifest_unavailable",
    });

    const emptyRoot = await createRoot();
    expect(await captureEnvironmentAttestation({ rootPath: emptyRoot, profile })).toEqual({
      status: "unknown",
      reason: "no_manifests",
    });
  });

  it("keeps unsupported profiles and missing roots unknown", async () => {
    expect(serverEnvironmentProfile("TASK_EXECUTION", { kind: "arbitrary" })).toBeNull();
    expect(await captureEnvironmentAttestation({ profile: null })).toEqual({
      status: "unknown",
      reason: "root_missing",
    });
    const root = await createRoot();
    expect(await captureEnvironmentAttestation({ rootPath: root, profile: null })).toEqual({
      status: "unknown",
      reason: "unsupported_profile",
    });
  });
});