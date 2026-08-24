import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getRepairValidationProfile,
  runRepairRuntimeOracle,
  runRepairValidation,
  validateRepairValidationScope,
} from "./ai-repair-validation.js";

describe("AI repair validation registry", () => {
  it("exposes only a registered bounded profile", () => {
    const profile = getRepairValidationProfile("ai-orchestrator-tests");
    expect(profile.command).toBe("pnpm");
    expect(profile.args).toEqual([
      "--filter",
      "@workspace/ai-orchestrator",
      "exec",
      "vitest",
      "run",
    ]);
    expect(profile.timeoutMs).toBeLessThanOrEqual(120_000);
  });

  it("accepts a changed file inside the selected profile scope", () => {
    expect(
      validateRepairValidationScope("ai-orchestrator-tests", [
        "lib/ai-orchestrator/src/tools/git-tools.ts",
      ]),
    ).toBeNull();
  });

  it("registers the workspace typecheck for implementation-plan changes", () => {
    const profile = getRepairValidationProfile("workspace-typecheck");
    expect(profile.command).toBe("pnpm");
    expect(profile.args).toEqual(["run", "typecheck"]);
    expect(
      validateRepairValidationScope("workspace-typecheck", ["artifacts/dashboard/src/pages/AiChat.tsx"]),
    ).toBeNull();
    expect(
      validateRepairValidationScope("workspace-typecheck", ["../outside-project.ts"]),
    ).toMatch(/does not cover changed file/i);
  });

  it("returns unavailable scope errors instead of executing an unrelated suite", () => {
    expect(
      validateRepairValidationScope("ai-orchestrator-tests", [
        "artifacts/api-server/src/routes/ai.test.ts",
      ]),
    ).toMatch(/does not cover changed file/i);
  });

  it("returns unavailable when the registered command cannot run from the project root", async () => {
    const result = await runRepairValidation("/tmp", "ai-orchestrator-tests", [
      "lib/ai-orchestrator/src/tools/git-tools.ts",
    ]);
    expect(result.status).toBe("unavailable");
    expect(result.detail).toMatch(/package\.json/i);
  });

  it("runs validation against pending content in an isolated workspace", async () => {
    const rootPath = path.resolve(process.cwd(), "../..");
    const relativePath = "artifacts/dashboard/src/pages/AiChat.tsx";
    const originalContent = await fs.readFile(path.join(rootPath, relativePath), "utf8");

    const result = await runRepairValidation(
      rootPath,
      "workspace-typecheck",
      [relativePath],
      undefined,
      [{ path: relativePath, newContent: `${originalContent}\nexport const invalid: = 1;\n` }],
    );

    expect(result.status).toBe("failed");
    expect(`${result.stdout}\n${result.stderr}\n${result.detail}`).toMatch(/invalid|expected|type/i);
    expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(originalContent);
  }, 120_000);

  it("runs a fixture runtime oracle against pending content without mutating live files", async () => {
    const rootPath = path.resolve(process.cwd(), "../..");
    const relativePath = "lib/ai-orchestrator/src/benchmark-scenarios/runtime-oracle.test.ts";
    const originalContent = [
      'import { describe, expect, it } from "vitest";',
      "",
      'const value = "broken";',
      "",
      'describe("runtime oracle", () => {',
      '  it("proves the pending behavior", () => expect(value).toBe("fixed"));',
      "});",
      "",
    ].join("\n");
    await fs.mkdir(path.dirname(path.join(rootPath, relativePath)), { recursive: true });
    await fs.writeFile(path.join(rootPath, relativePath), originalContent, "utf8");

    try {
      const result = await runRepairRuntimeOracle(
        rootPath,
        [{
          path: relativePath,
          newContent: originalContent.replace('"broken"', '"fixed"'),
        }],
        {
          command: "pnpm",
          args: ["--dir", "lib/ai-orchestrator", "exec", "vitest", "run", "src/benchmark-scenarios/runtime-oracle.test.ts"],
        },
      );

      expect(result).toEqual({ status: "passed" });
      expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(originalContent);
    } finally {
      await fs.rm(path.join(rootPath, relativePath), { force: true });
    }
  }, 120_000);

  it("fails closed when the runtime oracle rejects pending behavior", async () => {
    const rootPath = path.resolve(process.cwd(), "../..");
    const relativePath = "lib/ai-orchestrator/src/benchmark-scenarios/runtime-oracle-fail.test.ts";
    await fs.mkdir(path.dirname(path.join(rootPath, relativePath)), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, relativePath),
      [
        'import { describe, expect, it } from "vitest";',
        "",
        'const value = "broken";',
        "",
        'describe("runtime oracle", () => {',
        '  it("rejects the pending behavior", () => expect(value).toBe("fixed"));',
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      const result = await runRepairRuntimeOracle(
        rootPath,
        [],
        {
          command: "pnpm",
          args: ["--dir", "lib/ai-orchestrator", "exec", "vitest", "run", "src/benchmark-scenarios/runtime-oracle-fail.test.ts"],
        },
      );

      expect(result.status).toBe("failed");
      expect(result.code).toBe("RUNTIME_ORACLE_FAILED");
    } finally {
      await fs.rm(path.join(rootPath, relativePath), { force: true });
    }
  }, 120_000);
});