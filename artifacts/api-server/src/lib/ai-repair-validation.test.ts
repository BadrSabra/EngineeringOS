import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createValidatorChildEnvironment,
  createValidationWorkspace,
  getRepairValidationArgs,
  getRepairValidationProfile,
  runRepairRuntimeOracle,
  runRepairRuntimeValidation,
  runRepairValidation,
  validateRepairValidationScope,
  VALIDATION_WORKSPACE_MAX_FILE_BYTES,
} from "./ai-repair-validation.js";
import { config } from "../config.js";
import { serverEnvironmentProfile } from "./agent-state/environment-attestation.js";

describe("AI repair validation registry", () => {
  it("removes provider and identity credentials from validator child environments", () => {
    const childEnvironment = createValidatorChildEnvironment({
      PATH: "/usr/bin",
      DATABASE_URL: "postgresql://127.0.0.1:5432/test",
      OPENAI_API_KEY: "test-openai-secret",
      ANTHROPIC_API_KEY: "test-anthropic-secret",
      OPENROUTER_API_KEY: "test-openrouter-secret",
      GEMINI_API_KEY: "test-gemini-secret",
      DEEPSEEK_API_KEY: "test-deepseek-secret",
      GROQ_API_KEY: "test-groq-secret",
      CLERK_SECRET_KEY: "test-clerk-secret",
      CLERK_PUBLISHABLE_KEY: "test-clerk-publishable",
      VITE_CLERK_PUBLISHABLE_KEY: "test-vite-clerk-publishable",
      SESSION_SECRET: "test-session-secret",
      AI_LIFECYCLE_LIVE_CHECKS: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      RUN_REAL_API_PROCESS_RECOVERY: "1",
      BENCHMARK_LIVE_CAMPAIGN: "1",
    });

    expect(childEnvironment).toMatchObject({
      PATH: "/usr/bin",
      DATABASE_URL: "postgresql://127.0.0.1:5432/test",
    });
    for (const name of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
      "GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "GROQ_API_KEY",
      "CLERK_SECRET_KEY",
      "CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "SESSION_SECRET",
      "AI_LIFECYCLE_LIVE_CHECKS",
      "RUN_CONTROLLED_RELEASE_VALIDATION",
      "RUN_REAL_API_PROCESS_RECOVERY",
      "BENCHMARK_LIVE_CAMPAIGN",
    ]) {
      expect(childEnvironment).not.toHaveProperty(name);
    }
  });

  it("attests the direct runtime-validator child when a full server binding is supplied", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-validator-probe-"));
    try {
      await fs.writeFile(path.join(rootPath, "package.json"), JSON.stringify({
        name: "runtime-validator-probe",
        scripts: {
          "runtime-validator": "node -e \"setTimeout(() => {}, 4000)\"",
        },
      }) + "\n");
      const result = await runRepairRuntimeValidation(
        rootPath,
        [],
        {
          command: "pnpm",
          args: ["run", "runtime-validator"],
          timeoutMs: 8_000,
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

      expect(result.status, JSON.stringify(result.evidence)).toBe("passed");
      expect(result.evidence.validatorProfile).toBe("runtime-oracle");
      expect(result.evidence.childProcessAttestation?.status).toBe("known");
      const treeAttestation = result.evidence.validatorProcessTreeAttestation;
      expect(treeAttestation?.treeDigestVersion).toBe("validator-process-tree-v1");
      expect(JSON.stringify(treeAttestation)).not.toContain(rootPath);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not pass provider credentials to an unbound validator child", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-validator-env-"));
    try {
      await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"runtime-validator-env"}\n');
      const result = await runRepairRuntimeValidation(
        rootPath,
        [],
        {
          command: "pnpm",
          args: [
            "exec",
            "node",
            "-e",
            "process.stdout.write(process.env.OPENROUTER_API_KEY ? 'credential-present' : 'credential-absent')",
          ],
          timeoutMs: 5_000,
        },
      );

      expect(result.status).toBe("passed");
      expect(result.stdout).toBe("credential-absent");
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
    expect(profile.timeoutMs).toBeLessThanOrEqual(config.validationProcessTimeoutMs);
  });

  it("narrows generated benchmark validation to its exact fixture test", () => {
    const baseArgs = getRepairValidationProfile("ai-orchestrator-tests").args;
    const fixtureTest =
      "lib/ai-orchestrator/src/benchmark-scenarios/complete/multi-file-004/multi-file-004-1.test.ts";
    const fixtureImplementation =
      "lib/ai-orchestrator/src/benchmark-scenarios/complete/multi-file-004/multi-file-004-2.ts";

    expect(getRepairValidationArgs("ai-orchestrator-tests", [
      fixtureImplementation,
      fixtureTest,
    ])).toEqual([
      ...baseArgs,
      "src/benchmark-scenarios/complete/multi-file-004/multi-file-004-1.test.ts",
    ]);
    expect(getRepairValidationArgs("ai-orchestrator-tests", [
      "lib/ai-orchestrator/src/tools/git-tools.ts",
    ])).toEqual(baseArgs);
  });

  it("registers the bounded API repair validation profile for only its implementation and tests", () => {
    const profile = getRepairValidationProfile("api-repair-validation-tests");
    expect(profile.command).toBe("pnpm");
    expect(profile.args).toEqual([
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/lib/ai-repair-validation.test.ts",
      "-t",
      "API repair validation profile|runtime[- ]oracle|runtime-validator",
    ]);
    expect(profile.timeoutMs).toBeLessThanOrEqual(config.validationProcessTimeoutMs);
    expect(profile.maxBuffer).toBe(2_000_000);
    expect(
      validateRepairValidationScope("api-repair-validation-tests", [
        "artifacts/api-server/src/lib/ai-repair-validation.ts",
        "artifacts/api-server/src/lib/ai-repair-validation.test.ts",
      ]),
    ).toBeNull();
    expect(
      validateRepairValidationScope("api-repair-validation-tests", [
        "artifacts/api-server/src/lib/ai-repair-validation.helpers.ts",
      ]),
    ).toMatch(/does not cover changed file/i);
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

  it("omits nested ignored build and test outputs while preserving source files", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-output-source-"));
    const generatedDirectories = [
      ".test-roots/fixture",
      "artifacts/api-server/node_modules/pkg",
      "artifacts/api-server/dist",
      "artifacts/dashboard/test-results",
    ];
    for (const relative of generatedDirectories) {
      const directory = path.join(sourceRoot, relative);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "generated.txt"), "temporary\n", "utf8");
    }
    const generatedBuildInfoFiles = [
      "tsconfig.tsbuildinfo",
      "lib/db/tsconfig.tsbuildinfo",
    ];
    for (const relative of generatedBuildInfoFiles) {
      const file = path.join(sourceRoot, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "stale incremental state\n", "utf8");
    }
    const sourceFile = path.join(sourceRoot, "artifacts/dashboard/src/page.ts");
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, "export const page = true;\n", "utf8");

    let workspace: Awaited<ReturnType<typeof createValidationWorkspace>> | undefined;
    try {
      workspace = await createValidationWorkspace(sourceRoot, [], async () => {});

      expect(await fs.readFile(
        path.join(workspace.rootPath, "artifacts/dashboard/src/page.ts"),
        "utf8",
      )).toBe("export const page = true;\n");
      for (const relative of generatedDirectories) {
        await expect(fs.access(path.join(workspace.rootPath, relative))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      for (const relative of generatedBuildInfoFiles) {
        await expect(fs.access(path.join(workspace.rootPath, relative))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      await workspace?.cleanup();
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("relinks nested workspace dependencies to the isolated candidate", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-links-source-"));
    const mockupRoot = path.join(sourceRoot, "artifacts/mockup-sandbox");
    const apiZodRoot = path.join(sourceRoot, "lib/api-zod");
    const rootNodeModules = path.join(sourceRoot, "node_modules");
    const mockupNodeModules = path.join(mockupRoot, "node_modules");
    await fs.mkdir(mockupRoot, { recursive: true });
    await fs.mkdir(apiZodRoot, { recursive: true });
    await fs.writeFile(
      path.join(mockupRoot, "package.json"),
      JSON.stringify({ name: "@workspace/mockup-sandbox" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(apiZodRoot, "package.json"),
      JSON.stringify({ name: "@workspace/api-zod" }),
      "utf8",
    );
    await fs.mkdir(path.join(rootNodeModules, "@workspace"), { recursive: true });
    await fs.mkdir(path.join(rootNodeModules, "vite"), { recursive: true });
    await fs.writeFile(
      path.join(rootNodeModules, "vite/package.json"),
      JSON.stringify({ name: "vite" }),
      "utf8",
    );
    await fs.symlink(
      mockupRoot,
      path.join(rootNodeModules, "@workspace/mockup-sandbox"),
    );
    await fs.symlink(apiZodRoot, path.join(rootNodeModules, "@workspace/api-zod"));
    await fs.mkdir(path.join(mockupNodeModules, "@workspace"), { recursive: true });
    await fs.symlink(
      apiZodRoot,
      path.join(mockupNodeModules, "@workspace/api-zod"),
    );
    await fs.symlink(
      path.join(rootNodeModules, "vite"),
      path.join(mockupNodeModules, "vite"),
    );

    let workspace: Awaited<ReturnType<typeof createValidationWorkspace>> | undefined;
    try {
      workspace = await createValidationWorkspace(sourceRoot, [], async () => {});

      const candidateMockupRoot = path.join(
        workspace.rootPath,
        "artifacts/mockup-sandbox",
      );
      expect(await fs.realpath(
        path.join(workspace.rootPath, "node_modules/@workspace/mockup-sandbox"),
      )).toBe(candidateMockupRoot);
      expect(await fs.realpath(
        path.join(candidateMockupRoot, "node_modules/@workspace/api-zod"),
      )).toBe(path.join(workspace.rootPath, "lib/api-zod"));
      expect(await fs.realpath(
        path.join(candidateMockupRoot, "node_modules/vite"),
      )).toBe(path.join(rootNodeModules, "vite"));
    } finally {
      await workspace?.cleanup();
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("keeps lifecycle validation copies under the exact isolated project root", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-lifecycle-source-"));
    const remoteRoot = path.join(path.dirname(sourceRoot), `${path.basename(sourceRoot)}-remote`);
    await fs.mkdir(path.join(sourceRoot, ".git"), { recursive: true });
    await fs.mkdir(remoteRoot, { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "package.json"), '{"name":"lifecycle-source"}\n', "utf8");
    await fs.writeFile(path.join(sourceRoot, "README.md"), "original\n", "utf8");

    const envNames = [
      "ENGINEERING_AGENT_LIFECYCLE_E2E",
      "ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT",
      "ENGINEERING_AGENT_LIFECYCLE_REMOTE",
      "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE",
      "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON",
      "DASHBOARD_E2E_TEST_MODE",
      "DASHBOARD_E2E_LOCAL_AUTH_FIXTURE",
    ] as const;
    const previousEnvironment = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    ) as Record<(typeof envNames)[number], string | undefined>;
    Object.assign(process.env, {
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT: sourceRoot,
      ENGINEERING_AGENT_LIFECYCLE_REMOTE: remoteRoot,
      ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE: "lifecycle-local",
      ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON: JSON.stringify([
        sourceRoot,
        remoteRoot,
      ]),
      DASHBOARD_E2E_TEST_MODE: "fixture",
      DASHBOARD_E2E_LOCAL_AUTH_FIXTURE: "1",
    });

    let workspace: Awaited<ReturnType<typeof createValidationWorkspace>> | undefined;
    try {
      workspace = await createValidationWorkspace(sourceRoot, [
        { path: "README.md", newContent: "candidate\n" },
      ]);
      const relative = path.relative(
        path.join(sourceRoot, ".git"),
        workspace.rootPath,
      );
      expect(relative.startsWith(`..${path.sep}`)).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
      expect(await fs.readFile(path.join(workspace.rootPath, "README.md"), "utf8")).toBe(
        "candidate\n",
      );
    } finally {
      await workspace?.cleanup();
      for (const name of envNames) {
        const previous = previousEnvironment[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
      await fs.rm(sourceRoot, { recursive: true, force: true });
      await fs.rm(remoteRoot, { recursive: true, force: true });
    }
    expect(workspace).toBeDefined();
    await expect(fs.access(workspace!.rootPath)).rejects.toThrow();
  });

  it("fails closed when lifecycle validation roots do not match the project", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-lifecycle-mismatch-"));
    await fs.mkdir(path.join(sourceRoot, ".git"), { recursive: true });
    const envNames = [
      "ENGINEERING_AGENT_LIFECYCLE_E2E",
      "ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT",
      "ENGINEERING_AGENT_LIFECYCLE_REMOTE",
      "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE",
      "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON",
      "DASHBOARD_E2E_TEST_MODE",
      "DASHBOARD_E2E_LOCAL_AUTH_FIXTURE",
    ] as const;
    const previousEnvironment = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    ) as Record<(typeof envNames)[number], string | undefined>;
    Object.assign(process.env, {
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT: `${sourceRoot}-other`,
      ENGINEERING_AGENT_LIFECYCLE_REMOTE: `${sourceRoot}-remote`,
      ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE: "lifecycle-local",
      ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON: JSON.stringify([
        `${sourceRoot}-other`,
        `${sourceRoot}-remote`,
      ]),
      DASHBOARD_E2E_TEST_MODE: "fixture",
      DASHBOARD_E2E_LOCAL_AUTH_FIXTURE: "1",
    });
    try {
      await expect(
        createValidationWorkspace(sourceRoot, [
          { path: "README.md", newContent: "candidate\n" },
        ]),
      ).rejects.toThrow("validation_workspace_lifecycle_project_mismatch");
    } finally {
      for (const name of envNames) {
        const previous = previousEnvironment[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("rejects oversized source files before copying them into a validation workspace", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-copy-limit-"));
    try {
      const oversizedPath = path.join(sourceRoot, "large.bin");
      await fs.writeFile(oversizedPath, "");
      await fs.truncate(oversizedPath, VALIDATION_WORKSPACE_MAX_FILE_BYTES + 1);

      await expect(
        createValidationWorkspace(sourceRoot, [
          { path: "src.ts", newContent: "export const value = 2;\n" },
        ]),
      ).rejects.toThrow(/validation_workspace_file_limit_exceeded/);
    } finally {
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("stops validation workspace creation when the caller is already cancelled", async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "validation-copy-cancel-"));
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        createValidationWorkspace(
          sourceRoot,
          [{ path: "src.ts", newContent: "export const value = 2;\n" }],
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow(/validation_workspace_cancelled/);
    } finally {
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("runs validation against pending content in an isolated workspace", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "validation-pending-source-"));
    const relativePath = "src/AiChat.tsx";
    const originalContent = "export const valid = true;\n";
    try {
      await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "package.json"), JSON.stringify({
        name: "validation-pending-source",
        scripts: { typecheck: "node ./typecheck-fixture.mjs" },
      }) + "\n");
      await fs.writeFile(path.join(rootPath, relativePath), originalContent);
      await fs.writeFile(
        path.join(rootPath, "typecheck-fixture.mjs"),
        [
          'import { readFileSync } from "node:fs";',
          'const source = readFileSync("src/AiChat.tsx", "utf8");',
          'if (!source.includes("export const invalid: = 1;")) process.exit(0);',
          'console.error("invalid candidate content was observed");',
          'await new Promise((resolve) => setTimeout(resolve, 2_000));',
          "process.exitCode = 1;",
        ].join("\n") + "\n",
      );

      const result = await runRepairValidation(
        rootPath,
        "workspace-typecheck",
        [relativePath],
        undefined,
        [{ path: relativePath, newContent: `${originalContent}export const invalid: = 1;\n` }],
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

      expect(result.status, JSON.stringify(result)).toBe("failed");
      expect(result.evidence.validatorProfile).toBe("workspace-typecheck");
      expect(result.evidence.childProcessAttestation?.status).toBe("known");
      expect(result.evidence.environmentRevision).toBeNull();
      expect(`${result.stdout}\n${result.stderr}\n${result.detail}`).toMatch(/invalid|expected|type/i);
      expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(originalContent);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 210_000);

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

  it("enforces the overall runtime-oracle deadline across workspace preparation", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-validation-deadline-"));
    await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"runtime-validation-deadline"}\n');
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(config, "validationOverallTimeoutMs");
    let releasePrepare = (): void => undefined;
    let markPrepareStarted = (): void => undefined;
    let workspaceRootPath: string | undefined;
    const prepareStarted = new Promise<void>((resolve) => {
      markPrepareStarted = resolve;
    });
    const prepareGate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const startedAt = Date.now();

    try {
      if (!timeoutDescriptor) throw new Error("Missing runtime validation timeout setting.");
      Object.defineProperty(config, "validationOverallTimeoutMs", {
        ...timeoutDescriptor,
        value: 100,
      });
      const validationPromise = runRepairRuntimeValidation(
        rootPath,
        [],
        { command: "pnpm", args: ["--version"], timeoutMs: 5_000 },
        undefined,
        async (validationRootPath) => {
          workspaceRootPath = validationRootPath;
          markPrepareStarted();
          await prepareGate;
        },
        {
          operationId: "runtime-deadline-operation",
          projectRevision: "runtime-deadline-revision",
          candidateHash: "runtime-deadline-candidate",
        },
      );
      await prepareStarted;
      const result = await validationPromise;

      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(result).toMatchObject({
        status: "blocked",
        terminalState: "timed_out",
        failureKind: "timeout",
        overallBudgetMs: 100,
        remainingMs: 0,
      });
      expect(result.detail).toMatch(/overall attempt deadline/i);
      expect(result.evidence).toMatchObject({
        operationId: "runtime-deadline-operation",
        projectRevision: "runtime-deadline-revision",
        candidateHash: "runtime-deadline-candidate",
      });

      releasePrepare();
      expect(workspaceRootPath).toBeDefined();
      const cleanupDeadline = Date.now() + 2_000;
      let workspaceRemoved = false;
      while (Date.now() < cleanupDeadline) {
        try {
          await fs.access(workspaceRootPath!);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          workspaceRemoved = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(workspaceRemoved).toBe(true);
    } finally {
      releasePrepare();
      if (timeoutDescriptor) {
        Object.defineProperty(config, "validationOverallTimeoutMs", timeoutDescriptor);
      }
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  }, 10_000);

  it("distinguishes caller cancellation from runtime-oracle timeout", async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-validation-cancel-"));
    await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"runtime-validation-cancel"}\n');
    const command = { command: "pnpm" as const, args: ["--version"], timeoutMs: 5_000 };

    try {
      const canonicalController = new AbortController();
      const canonical = await runRepairRuntimeValidation(
        rootPath,
        [],
        command,
        canonicalController.signal,
        async () => canonicalController.abort(),
      );
      expect(canonical).toMatchObject({
        status: "blocked",
        terminalState: "blocked",
        failureKind: "cancelled",
      });

      const compatibilityController = new AbortController();
      const compatibility = await runRepairRuntimeOracle(
        rootPath,
        [],
        command,
        compatibilityController.signal,
        async () => compatibilityController.abort(),
      );
      expect(compatibility).toMatchObject({
        status: "failed",
        code: "RUNTIME_ORACLE_CANCELLED",
      });
      expect(compatibility.detail).toMatch(/cancel/i);

      const timedOutCompatibility = await runRepairRuntimeOracle(
        rootPath,
        [],
        {
          command: "pnpm",
          args: ["exec", "node", "-e", "setTimeout(() => {}, 5_000)"],
          timeoutMs: 100,
        },
      );
      expect(timedOutCompatibility).toMatchObject({
        status: "failed",
        code: "RUNTIME_ORACLE_TIMED_OUT",
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
