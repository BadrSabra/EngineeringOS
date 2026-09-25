import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createValidationWorkspace,
  getRepairValidationProfile,
  runRepairRuntimeOracle,
  runRepairRuntimeValidation,
  runRepairValidation,
  validateRepairValidationScope,
} from "./ai-repair-validation.js";
import { serverEnvironmentProfile } from "./agent-state/environment-attestation.js";

describe("AI repair validation registry", () => {
  it("attests the direct runtime-validator child when a full server binding is supplied", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-validator-probe-"));
    try {
      await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"runtime-validator-probe"}\n');
      const result = await runRepairRuntimeValidation(
        rootPath,
        [],
        {
          command: "pnpm",
          args: ["exec", "node", "-e", "setTimeout(() => {}, 700)"],
          timeoutMs: 5_000,
        },
        undefined,
        undefined,
        {
          operationId: "runtime-validator-operation",
          projectRevision: "runtime-validator-revision",
          childProcessIdentity: {
            projectId: "runtime-validator-project",
            executionId: "runtime-validator-execution",
            executionAttempt: 0,
            episodeId: "runtime-validator-episode",
            operationId: "runtime-validator-operation",
            revision: "runtime-validator-revision",
          },
        },
      );

      expect(result.status).toBe("passed");
      expect(result.evidence.validatorProfile).toBe("runtime-oracle");
      expect(result.evidence.childProcessAttestation?.status).toBe("known");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10_000);

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

  it("registers a fixed Go module test profile without exposing shell input", () => {
    const profile = getRepairValidationProfile("go-tests");
    expect(profile.command).toBe("go");
    expect(profile.args).toEqual(["test", "./..."]);
    expect(profile.requiredFiles).toEqual(["go.mod"]);
    expect(validateRepairValidationScope("go-tests", ["internal/math/math.go"])).toBeNull();
    expect(validateRepairValidationScope("go-tests", ["package.json"])).toMatch(/does not cover changed file/i);
  });

  it("returns unavailable for Go validation when the module manifest is missing", async () => {
    const result = await runRepairValidation("/tmp", "go-tests", ["main.go"]);
    expect(result.status).toBe("unavailable");
    expect(result.evidence.environmentRevision).toBeNull();
    expect(result.detail).toMatch(/go\.mod/i);
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
    expect(result.evidence.environmentRevision).toBeNull();
    expect(result.detail).toMatch(/package\.json/i);
    expect(result.processBudgetMs).toBeGreaterThan(0);
    expect(result.overallBudgetMs).toBeGreaterThanOrEqual(result.processBudgetMs ?? 0);
    expect(result.terminalState).toBe("unavailable");
    expect(result.nextAction).toMatch(/profile|workspace|validation/i);
  });

  it("keeps validation workspaces outside a redirected TMPDIR and cleans them up", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-source-"));
    const hostileTmpDir = path.join(sourceRoot, ".engineeringos-delivery", "validation-tmp");
    await fs.mkdir(path.join(sourceRoot, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "package.json"), '{"name":"validation-source"}\n', "utf8");
    await fs.writeFile(path.join(sourceRoot, "src.ts"), "export const value = 1;\n", "utf8");
    await fs.mkdir(hostileTmpDir, { recursive: true });

    const previousTmpDir = process.env.TMPDIR;
    process.env.TMPDIR = hostileTmpDir;
    let workspace: Awaited<ReturnType<typeof createValidationWorkspace>> | undefined;
    try {
      workspace = await createValidationWorkspace(sourceRoot, [
        { path: "src.ts", newContent: "export const value = 2;\n" },
      ]);

      expect(path.dirname(workspace.rootPath)).toBe("/tmp");
      expect(workspace.rootPath).not.toContain(".engineeringos-delivery");
      expect(await fs.readFile(path.join(workspace.rootPath, "src.ts"), "utf8")).toBe(
        "export const value = 2;\n",
      );
    } finally {
      await workspace?.cleanup();
      if (previousTmpDir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpDir;
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }

    expect(workspace).toBeDefined();
    await expect(fs.access(workspace!.rootPath)).rejects.toThrow();
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
      {
        environmentProfile: serverEnvironmentProfile("CANDIDATE_VALIDATION", {
          kind: "recipe",
          operationId: "validation-environment-test",
          recipeId: "candidate.verify",
          candidateIdentity: "candidate-validation-test",
          validationProfiles: ["workspace-typecheck"],
        }),
        childProcessIdentity: {
          projectId: "validation-attestation-project",
          executionId: "validation-attestation-execution",
          executionAttempt: 0,
          episodeId: "validation-attestation-episode",
          operationId: "validation-environment-test",
          revision: "validation-attestation-revision",
        },
      },
    );

    expect(result.status).toBe("failed");
    expect(result.evidence.validatorProfile).toBe("workspace-typecheck");
    expect(result.evidence.childProcessAttestation?.status).toBe("known");
    expect(result.evidence.environmentRevision).toBeNull();
    expect(`${result.stdout}\n${result.stderr}\n${result.detail}`).toMatch(/invalid|expected|type/i);
    expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(originalContent);
  }, 120_000);

  it("runs a fixture runtime oracle against pending content without mutating live files", async () => {
    const rootPath = path.resolve(process.cwd(), "../..");
    const relativePath = "lib/ai-orchestrator/src/benchmark-fixtures/runtime-oracle-passing.test.ts";
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
          args: [
            "--dir",
            "lib/ai-orchestrator",
            "exec",
            "vitest",
            "run",
            "src/benchmark-fixtures/runtime-oracle-passing.test.ts",
          ],
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
    const relativePath = "lib/ai-orchestrator/src/benchmark-fixtures/runtime-oracle-failing.test.ts";
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
          args: [
            "--dir",
            "lib/ai-orchestrator",
            "exec",
            "vitest",
            "run",
            "src/benchmark-fixtures/runtime-oracle-failing.test.ts",
          ],
        },
      );

      expect(result.status).toBe("failed");
      expect(result.code).toBe("RUNTIME_ORACLE_FAILED");
    } finally {
      await fs.rm(path.join(rootPath, relativePath), { force: true });
    }
  }, 120_000);
});