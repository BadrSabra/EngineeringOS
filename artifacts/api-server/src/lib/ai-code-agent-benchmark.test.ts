import path from "node:path";
import { describe, it } from "vitest";
import { validateApiCodeAgentBenchmarkRuntimeOracles } from "./ai-code-agent-benchmark.js";

describe("Code Agent benchmark runtime-oracle preflight", () => {
  it("runs every maintained runtime oracle against its focused candidate", async () => {
    await validateApiCodeAgentBenchmarkRuntimeOracles({
      rootPath: path.resolve(process.cwd(), "../.."),
    });
  }, 120_000);
});