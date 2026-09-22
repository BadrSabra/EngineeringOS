import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createServerCapabilityRegistry,
} from "../recipe-capabilities.js";

async function projectFixture(): Promise<{ root: string; outside: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "recipe-capability-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "recipe-capability-outside-"));
  await writeFile(path.join(root, "safe.ts"), "export const safe = true;\n");
  await writeFile(path.join(root, ".env"), "SECRET=hidden\n");
  await writeFile(path.join(outside, "secret.ts"), "export const secret = true;\n");
  await symlink(path.join(outside, "secret.ts"), path.join(root, "link.ts"));
  return { root, outside };
}

describe("recipe capability adapters", () => {
  it("registers the server-owned validation, browser, and read capabilities", () => {
    const registry = createServerCapabilityRegistry({ browserProfiles: ["default"] });
    expect(registry.list().map((entry) => entry.id)).toEqual([
      "browser.verify.default",
      "project.read_file",
      "validation.run.ai-orchestrator-tests",
      "validation.run.api-ai-tests",
      "validation.run.knowledge-engine-tests",
      "validation.run.workspace-typecheck",
    ]);
  });

  it("registers external delivery only when the server supplies its runner", () => {
    const calls: Array<Record<string, unknown>> = [];
    const registry = createServerCapabilityRegistry({
      githubDeliveryRunner: async (args) => {
        calls.push(args);
        return {
          status: "passed",
          evidence: {
            evidenceId: "integration:verified",
            resultHash: "a".repeat(64),
            artifactRef: "github:delivery",
          },
          remoteCommitHash: "remote-commit",
        };
      },
    });

    expect(registry.list().map((entry) => entry.id)).toContain("github.push_verified_commit");
    return expect(registry.invoke(
      "github.push_verified_commit",
      1,
      { message: "Verified delivery" },
      {
        rootPath: process.cwd(),
        projectId: "project-1",
        operation: "recipe",
        operationId: "operation-1",
        authorized: true,
        approvalState: "APPROVED",
      },
    )).resolves.toMatchObject({
      ok: true,
      output: {
        status: "passed",
        evidence: { evidenceId: "integration:verified" },
      },
    }).then(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        projectId: "project-1",
        operationId: "operation-1",
        message: "Verified delivery",
      });
    });
  });

  it("fails closed when external delivery has no durable identity", async () => {
    const registry = createServerCapabilityRegistry({
      githubDeliveryRunner: async () => ({
        status: "passed",
        evidence: { evidenceId: "should-not-run" },
      }),
    });
    await expect(registry.invoke(
      "github.push_verified_commit",
      1,
      { message: "Verified delivery" },
      {
        rootPath: process.cwd(),
        operation: "recipe",
        authorized: true,
        approvalState: "APPROVED",
      },
    )).resolves.toMatchObject({
      ok: true,
      output: {
        status: "blocked",
      },
    });
  });

  it("accepts an approved real file and rejects an unapproved path", async () => {
    const { root } = await projectFixture();
    const registry = createServerCapabilityRegistry();
    const context = {
      rootPath: root,
      operation: "recipe",
      authorized: true,
      scope: { kind: "file" as const, paths: ["safe.ts"] },
      allowedFiles: ["safe.ts"],
    };
    await expect(registry.invoke("project.read_file", 1, { path: "safe.ts" }, context))
      .resolves.toMatchObject({ ok: true, output: { path: "safe.ts" } });
    await expect(registry.invoke("project.read_file", 1, { path: ".env" }, context))
      .resolves.toMatchObject({ ok: false, code: "CAPABILITY_SCOPE_VIOLATION" });
  });

  it("rejects a realpath escape through a symlink before the adapter runs", async () => {
    const { root } = await projectFixture();
    const registry = createServerCapabilityRegistry();
    await expect(registry.invoke("project.read_file", 1, { path: "link.ts" }, {
      rootPath: root,
      operation: "recipe",
      scope: { kind: "file", paths: ["link.ts"] },
      allowedFiles: ["link.ts"],
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_SCOPE_VIOLATION" });
  });

  it("fails closed when a scoped validation adapter targets a sensitive file", async () => {
    const { root } = await projectFixture();
    const registry = createServerCapabilityRegistry();
    await expect(registry.invoke("validation.run.workspace-typecheck", 1, {
      targetPaths: [".env"],
    }, {
      rootPath: root,
      operation: "recipe",
      authorized: true,
      scope: { kind: "paths", paths: [".env"] },
      allowedFiles: [".env"],
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_SCOPE_VIOLATION" });
  });
});