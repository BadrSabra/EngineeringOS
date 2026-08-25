import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContext } from "../context-builder.js";
import {
  buildProjectFileManifest,
  formatProjectFileManifest,
  type ProjectFileManifest,
} from "../filesystem-manifest.js";
import { buildImplementationPlanMessages } from "../prompts/implementation-plan.prompt.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(
  filesystemManifest?: ProjectFileManifest,
  filesystemSources?: ProjectContext["filesystemSources"],
): ProjectContext {
  return {
    project: "test | grounded planning",
    workflows: "No workflows defined yet",
    recentTasks: "No tasks yet",
    latestMetrics: "No metrics yet",
    graphSummary: "No graph data yet",
    recentEvents: "No recent events",
    metricsVerified: false,
    ...(filesystemManifest ? { filesystemManifest } : {}),
    ...(filesystemSources ? { filesystemSources } : {}),
  };
}

function providerPlan(files: string[]) {
  return JSON.stringify({
    kind: "IMPLEMENTATION_PLAN_RESULT",
    objective: "Update the verified target",
    summary: "Prepare a reviewable change for the verified target.",
    assumptions: [],
    steps: [{
      id: "step-1",
      title: "Update the target",
      description: "Modify the requested implementation file.",
      action: "modify",
      files,
      dependsOn: [],
      validation: ["Run the focused test"],
    }],
    validationCommands: ["pnpm test"],
    risks: [],
    approvalStatus: "PENDING_APPROVAL",
    writeAccess: "NOT_AUTHORIZED",
  });
}

describe("implementation-plan filesystem grounding", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("builds a bounded manifest with real project-relative paths", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-manifest-"));
    try {
      await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
      await fs.mkdir(path.join(rootPath, "node_modules", "ignored"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "package.json"), "{}\n", "utf8");
      await fs.writeFile(path.join(rootPath, "src", "routes.ts"), "export {};\n", "utf8");
      await fs.writeFile(path.join(rootPath, "node_modules", "ignored", "index.js"), "", "utf8");

      const manifest = await buildProjectFileManifest(rootPath);

      expect(manifest.status).toBe("VERIFIED");
      expect(manifest.files).toContain("package.json");
      expect(manifest.files).toContain("src/routes.ts");
      expect(manifest.directories).toContain("src");
      expect(manifest.files).not.toContain("node_modules/ignored/index.js");
      expect(formatProjectFileManifest(manifest)).toContain("src/routes.ts");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("includes the verified manifest in the planning prompt", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-prompt-manifest-"));
    try {
      await fs.writeFile(path.join(rootPath, "package.json"), "{}\n", "utf8");
      const manifest = await buildProjectFileManifest(rootPath);
      const messages = buildImplementationPlanMessages(
        "Update the project",
        makeContext(manifest),
      );

      expect(messages[1].content).toContain("VERIFIED FILESYSTEM MANIFEST");
      expect(messages[1].content).toContain("package.json");
      expect(messages[1].content).toContain("must match an entry below exactly");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails closed without a verified filesystem manifest", async () => {
    const create = vi.fn();
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    const { createImplementationPlan } = await import("../agents/implementation-planner.js");
    const result = await createImplementationPlan({
      message: "Improve the project",
      projectContext: makeContext(),
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.steps[0]?.files).toEqual([]);
    expect(result.assumptions[0]).toMatch(/filesystem manifest|context/i);
    expect(result.writeAccess).toBe("NOT_AUTHORIZED");
  });

  it("rejects provider plans that reference unverified existing paths", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: providerPlan(["src/missing.ts"]) } }],
      model: "grounding-test-model",
      usage: {},
    });
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-plan-grounding-"));
    try {
      await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "src", "routes.ts"), "export {};\n", "utf8");
      const manifest = await buildProjectFileManifest(rootPath);
      const { createImplementationPlan } = await import("../agents/implementation-planner.js");
      const result = await createImplementationPlan({
        message: "Update the routes",
        projectContext: makeContext(manifest, {
          status: "VERIFIED",
          files: [{
            path: "src/routes.ts",
            content: "export {};\n",
            truncated: false,
          }],
          truncated: false,
        }),
      }, { provider: "groq", apiKey: "test-key" });

      expect(create).toHaveBeenCalled();
      expect(result.steps[0]?.files).toEqual([]);
      expect(result.assumptions[0]).toContain("src/missing.ts");
      expect(result.writeAccess).toBe("NOT_AUTHORIZED");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});