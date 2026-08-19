import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawGroqResponse } from "../groq-client.js";
import { executeToolLoop } from "../tool-execution-engine.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function response(content: string, toolCalls: RawGroqResponse["toolCalls"] = null): RawGroqResponse {
  return {
    content,
    toolCalls,
    model: "test-model",
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

describe("forensic live read path", () => {
  it("executes a real read_file and returns its source body to the forensic loop", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-forensic-"));
    tempRoots.push(root);
    const source = "export function verifiedRead() { return true; }\n";
    await fs.writeFile(path.join(root, "verified.ts"), source, "utf8");

    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: async (_messages, callNumber) => {
        if (callNumber.tools?.some((tool) => tool.function.name === "read_file")) {
          return response("", [{
            id: "read-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "verified.ts" }),
            },
          }]);
        }
        return response("final synthesis");
      },
      stream: async function* () {
        yield "";
      },
    };
    const steps: Array<Record<string, unknown>> = [];

    const result = await executeToolLoop({
      messages: [{ role: "user", content: "inspect verified.ts" }],
      strategy,
      model: "test-model",
      powerModel: "test-power-model",
      provider: "test",
      apiKey: "test-key",
      rootPath: root,
      pendingChanges: [],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a source file",
          parameters: { type: "object" },
        },
      }],
      executionMode: "forensic",
      completeReads: true,
      maxIterations: 4,
      maxToolCalls: 4,
      onStep: (step) => {
        steps.push(step as unknown as Record<string, unknown>);
      },
    });

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.toolSources).toContain("verified.ts");
    expect(result.fileContents?.get("verified.ts")).toContain(source);
    expect(result.fileContents?.get("verified.ts")).not.toContain("forensic read exceeded");
    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_call", tool: "read_file" }),
      expect.objectContaining({ kind: "tool_result", tool: "read_file", source: "verified.ts" }),
    ]));
    const sourceRead = steps.find(
      (step) => step.kind === "tool_result" && step.tool === "read_file",
    );
    expect(sourceRead).toMatchObject({ cached: false });
    expect(sourceRead).not.toHaveProperty("prefetched");
  });
});