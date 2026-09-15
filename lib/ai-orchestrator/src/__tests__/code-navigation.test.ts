import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeCodeNavigationTool } from "../tools/code-navigation.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("code navigation tools", () => {
  it("returns server-bound definitions and AST references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-navigation-"));
    temporaryRoots.push(root);
    await writeFile(
      path.join(root, "sample.ts"),
      "export function greet(name: string) { return name; }\nconst result = greet('Ada');\n",
    );

    const definition = JSON.parse(await executeCodeNavigationTool(
      "symbol_search",
      { symbol: "greet" },
      root,
      { operationId: "op-1", revision: "rev-1" },
    )) as { status: string; workspaceRevision: string; results: Array<{ kind: string }> };
    const references = JSON.parse(await executeCodeNavigationTool(
      "ast_navigation",
      { operation: "references", symbol: "greet" },
      root,
      { operationId: "op-1", revision: "rev-1" },
    )) as { status: string; results: Array<{ kind: string }> };

    expect(definition.status).toBe("complete");
    expect(definition.workspaceRevision).toBe("rev-1");
    expect(definition.results.some((result) => result.kind === "definition")).toBe(true);
    expect(references.status).toBe("complete");
    expect(references.results.some((result) => result.kind === "reference")).toBe(true);
  });

  it("fails closed when the server does not provide revision context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-navigation-"));
    temporaryRoots.push(root);

    const output = JSON.parse(await executeCodeNavigationTool(
      "ast_navigation",
      { operation: "definition", symbol: "greet" },
      root,
    )) as { status: string; code: string };

    expect(output).toEqual({
      tool: "ast_navigation",
      status: "unavailable",
      code: "NAVIGATION_REVISION_CONTEXT_REQUIRED",
      detail: "Code navigation requires a server-owned operation and workspace revision.",
    });
  });
});