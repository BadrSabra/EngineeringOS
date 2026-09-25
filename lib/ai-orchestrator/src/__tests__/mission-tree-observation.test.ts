import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProviderTools } from "../agents/chat-agent.js";
import { executeSingleTool } from "../tool-execution-engine.js";

const fixtures: string[] = [];
const manifestHash = createHash("sha256").update("mission-manifest").digest("hex");

async function createProjectFixture(): Promise<string> {
  const root = path.join("/tmp", `mission-observation-${process.pid}-${Date.now()}-${fixtures.length}`);
  fixtures.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "allowed.ts"), "export const allowed = true;\n", "utf8");
  await fs.writeFile(path.join(root, "src", "other.ts"), "export const other = true;\n", "utf8");
  return root;
}

describe("Mission project tree observation", () => {
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ));
  });

  it("keeps the tree out of ordinary manifests and exact in Mission manifests", () => {
    const rootPath = "/tmp/mission-manifest-project";
    const ordinaryTools = buildProviderTools(
      "groq",
      rootPath,
      "forensic",
      false,
      false,
      [],
      false,
      false,
      false,
      true,
      "workspace",
    ) ?? [];
    const missionTools = buildProviderTools(
      "groq",
      rootPath,
      "forensic",
      false,
      false,
      [],
      false,
      false,
      false,
      true,
      "workspace",
      ["project.list_tree", "read_file", "read_file_range"],
    ) ?? [];
    const ordinaryNames = ordinaryTools.map((tool) => tool.function.name);
    const missionNames = missionTools.map((tool) => tool.function.name);

    expect(ordinaryNames).not.toContain("project.list_tree");
    expect(ordinaryNames).toContain("list_directory");
    expect(missionNames).toEqual(expect.arrayContaining([
      "project.list_tree",
      "read_file",
      "read_file_range",
    ]));
    expect(new Set(missionNames)).toEqual(
      new Set(["project.list_tree", "read_file", "read_file_range"]),
    );
    expect(missionNames).not.toContain("list_directory");
    expect(missionNames).not.toContain("search_code");
  });

  it("records the bounded tree request and result before returning the output", async () => {
    const rootPath = await createProjectFixture();
    const observations: Array<{ phase: string; toolName: string }> = [];
    const result = await executeSingleTool({
      name: "project.list_tree",
      args: {},
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-tree-call-1",
      allowedToolNames: new Set(["project.list_tree"]),
      toolManifestHash: manifestHash,
      onReadOnlyInvocation: async (invocation) => {
        observations.push({ phase: invocation.phase, toolName: invocation.toolName });
      },
    });

    expect(observations).toEqual([
      { phase: "requested", toolName: "project.list_tree" },
      { phase: "recorded", toolName: "project.list_tree" },
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.output).toContain("src/allowed.ts");
      expect(result.output).not.toContain("export const allowed");
    }
  });

  it("withholds tree output when recording the result fails", async () => {
    const rootPath = await createProjectFixture();
    const phases: string[] = [];
    const result = await executeSingleTool({
      name: "project.list_tree",
      args: {},
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-tree-call-2",
      allowedToolNames: new Set(["project.list_tree"]),
      toolManifestHash: manifestHash,
      onReadOnlyInvocation: async (invocation) => {
        phases.push(invocation.phase);
        if (invocation.phase === "recorded") throw new Error("ledger unavailable");
      },
    });

    expect(phases).toEqual(["requested", "recorded"]);
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.safeMessage).not.toContain("src/allowed.ts");
    }
  });

  it("requires explicit manifest authorization for tree access", async () => {
    const rootPath = await createProjectFixture();
    const result = await executeSingleTool({
      name: "project.list_tree",
      args: {},
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-tree-call-3",
      toolManifestHash: manifestHash,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.safeMessage).toContain("server authorization gate");
    }
  });

  it("enforces the exact Mission file scope and rejects generic list/search tools", async () => {
    const rootPath = await createProjectFixture();
    const callbacks: string[] = [];
    const scope = ["src/allowed.ts"];
    const outsideRead = await executeSingleTool({
      name: "read_file",
      args: { path: "src/other.ts" },
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-read-outside",
      allowedToolNames: new Set(["read_file", "list_directory", "search_code"]),
      missionReadPathScope: scope,
      toolManifestHash: manifestHash,
      onReadOnlyInvocation: async (invocation) => {
        callbacks.push(invocation.phase);
      },
    });
    const directoryListing = await executeSingleTool({
      name: "list_directory",
      args: { path: "." },
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-list-directory",
      allowedToolNames: new Set(["read_file", "list_directory", "search_code"]),
      missionReadPathScope: scope,
      toolManifestHash: manifestHash,
    });
    const projectSearch = await executeSingleTool({
      name: "search_code",
      args: { pattern: "allowed" },
      rootPath,
      pendingChanges: [],
      toolCallId: "mission-search",
      allowedToolNames: new Set(["read_file", "list_directory", "search_code"]),
      missionReadPathScope: scope,
      toolManifestHash: manifestHash,
    });

    expect(outsideRead.kind).toBe("failed");
    expect(directoryListing.kind).toBe("failed");
    expect(projectSearch.kind).toBe("failed");
    expect(callbacks).toEqual([]);
  });
});