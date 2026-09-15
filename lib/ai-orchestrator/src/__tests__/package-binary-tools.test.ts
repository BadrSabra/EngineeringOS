import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeBinaryTool } from "../tools/binary-tools.js";
import { executePackageTool } from "../tools/package-tools.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("package and binary inspection tools", () => {
  it("summarizes package.json without exposing dependency values or mutating files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-package-"));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: { express: "^1.0.0" },
      devDependencies: { vitest: "^1.0.0" },
      scripts: { test: "vitest" },
    }));

    const output = JSON.parse(await executePackageTool(
      "inspect_dependencies",
      {},
      root,
      { operationId: "op-package", revision: "rev-package" },
    )) as {
      status: string;
      workspaceRevision: string;
      summary: { dependencies: string[]; scripts: string[] };
    };

    expect(output.status).toBe("complete");
    expect(output.workspaceRevision).toBe("rev-package");
    expect(output.summary.dependencies).toEqual(["express"]);
    expect(output.summary.scripts).toEqual(["test"]);
  });

  it("detects PNG metadata and binds the result to the operation revision", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-binary-"));
    roots.push(root);
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000002000000030806000000",
      "hex",
    );
    await writeFile(path.join(root, "image.png"), png);

    const output = JSON.parse(await executeBinaryTool(
      "inspect_binary",
      { path: "image.png" },
      root,
      { operationId: "op-binary", revision: "rev-binary" },
    )) as {
      status: string;
      mediaType: string;
      width: number;
      height: number;
      hashComplete: boolean;
      workspaceRevision: string;
    };

    expect(output.status).toBe("complete");
    expect(output.mediaType).toBe("image/png");
    expect(output.width).toBe(2);
    expect(output.height).toBe(3);
    expect(output.hashComplete).toBe(true);
    expect(output.workspaceRevision).toBe("rev-binary");
  });

  it("fails closed for sensitive binary paths and missing revision context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ai-binary-"));
    roots.push(root);
    await writeFile(path.join(root, ".env"), "SECRET=do-not-read");

    const sensitive = JSON.parse(await executeBinaryTool(
      "inspect_binary",
      { path: ".env" },
      root,
      { operationId: "op-binary", revision: "rev-binary" },
    )) as { status: string; code: string };
    const unbound = JSON.parse(await executePackageTool(
      "inspect_dependencies",
      {},
      root,
    )) as { status: string; code: string };

    expect(sensitive.code).toBe("BINARY_PATH_NOT_ALLOWED");
    expect(unbound.code).toBe("PACKAGE_REVISION_CONTEXT_REQUIRED");
    expect(sensitive.status).toBe("unavailable");
    expect(unbound.status).toBe("unavailable");
  });
});