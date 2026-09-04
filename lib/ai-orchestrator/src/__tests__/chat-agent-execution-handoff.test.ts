/**
 * Runtime-shaped execution handoff coverage.
 *
 * This test intentionally exercises chat() with a recovered Repair Plan and a
 * real temporary file. It proves the focused replacement proposal, memory
 * isolation, and approval gate without requiring a live provider credential.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContext } from "../context-builder.js";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { resolveTurnIntent } from "../turn-intent.js";

function makeContext(): ProjectContext {
  return {
    project: "test | execution handoff",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
    sessionMemories: "Previously accessed files:\n  • unrelated.ts\n  • another.ts",
  };
}

const originalApiKey = process.env.GROQ_API_KEY;

describe("chat agent — recovered Repair Plan execution", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("starts a proposed analysis with a read and never exposes write tools", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-analysis-start-"));
    const relativePath = "src/target.ts";
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, relativePath),
      "export const enabled = true;\n",
      "utf8",
    );

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "read-analysis-target",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: relativePath }) },
            }],
          },
        }],
        model: "analysis-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              response: [
                "## 1) Executive Verdict",
                "NO_VERIFIED_FINDING — the source was read and no defect is proven.",
                "## 2) Evidence Map",
                `- Read: \`${relativePath}\``,
                "## 3) Findings",
                "No verified finding.",
                "## 4) Repair Plan",
                "No repair phase.",
                "## 5) Validation Checklist",
                "No validation is required because no finding was accepted.",
                "## 6) Final Judgment",
                "Analysis complete from the read source.",
              ].join("\n"),
              sources: [relativePath],
            }),
          },
        }],
        model: "analysis-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: Array<{ kind: string; tool?: string }> = [];
      const priorAnalysis = classifyRequest(
        "Audit src/target.ts and identify important problems.",
      );
      const result = await chat({
        message: "ابدأ",
        history: [{
          role: "assistant",
          content: "سأقترح نطاق التحليل أولًا، ثم أبدأ بقراءة المصدر عند موافقتك.",
        }],
        projectContext: makeContext(),
        rootPath,
        turnIntent: resolveTurnIntent("ابدأ", {
          classification: priorAnalysis,
          resumed: true,
        }),
        onStep: (step) => {
          if (step.kind === "tool_call") steps.push({ kind: step.kind, tool: step.tool });
        },
      });

      expect(result.pendingChanges).toEqual([]);
      expect(steps.map((step) => step.tool)).toEqual(["read_file"]);
      const request = create.mock.calls
        .map((call) => call[0] as { tools?: Array<{ function?: { name?: string } }> })
        .find((candidate) =>
          candidate.tools?.some((tool) => tool.function?.name === "read_file"),
        );
      expect(request).toBeDefined();
      const exposedTools = (request!.tools ?? []).map((tool) => tool.function?.name);
      expect(exposedTools).toContain("read_file");
      expect(exposedTools).not.toContain("write_file");
      expect(exposedTools).not.toContain("replace_text");
      expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(
        "export const enabled = true;\n",
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("prefetches only the target, queues replace_text, and does not write to disk", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-handoff-"));
    const relativePath = "target.ts";
    const absolutePath = path.join(rootPath, relativePath);
    const originalContent = "export const enabled = true;\n";
    await fs.writeFile(absolutePath, originalContent, "utf8");

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "read-1",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: relativePath }) },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "replace-1",
              type: "function",
              function: {
                name: "replace_text",
                arguments: JSON.stringify({
                  path: relativePath,
                  old_text: "export const enabled = true;",
                  new_text: "export const enabled = false;",
                  reason: "Apply the verified Repair Plan change",
                }),
              },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"response":"Change queued for approval.","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: Array<{ kind: string; tool?: string; cached?: boolean }> = [];
      const result = await chat({
        message: "نفذ Repair Plan",
        history: [
          { role: "user", content: "راجع الكود" },
          {
            role: "assistant",
            content: [
              "## 3) Findings",
              "* ID: F-01 · HIGH",
              `* File(s): \`${relativePath}\``,
              "* Evidence: `export const enabled = true`",
              "* Why it matters: the flag is incorrect",
              "* Root cause: incorrect configuration",
              "* Fix: update the flag",
              "## 4) Repair Plan",
              `Phase 1 (F-01): Update the verified implementation — \`${relativePath}\``,
            ].join("\n"),
          },
        ],
        projectContext: makeContext(),
        rootPath,
        onStep: (step) => {
          if (step.kind === "tool_call") {
            steps.push({ kind: step.kind, tool: step.tool, cached: step.cached });
          }
        },
      });

      // The target file is loaded by the execution prefetch before the model
      // loop. The execution tool list therefore starts at the edit step and
      // ignores unrelated session-memory paths.
      expect(steps.map((step) => step.tool)).toEqual(["replace_text"]);
      expect(result.pendingChanges).toHaveLength(1);
      expect(result.pendingChanges[0]?.path).toBe(relativePath);
      expect(result.pendingChanges[0]?.newContent).toContain("enabled = false");
      expect(await fs.readFile(absolutePath, "utf8")).toBe(originalContent);
      expect(create).toHaveBeenCalledTimes(3);

      const firstRequest = create.mock.calls[0]?.[0] as {
        messages?: Array<{
          role?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        }>;
        tools?: Array<{ function?: { name?: string } }>;
      };
      const exposedTools = (firstRequest.tools ?? []).map((tool) => tool.function?.name);
      expect(exposedTools).toEqual(
        expect.arrayContaining(["replace_text", "write_file"]),
      );
      expect(exposedTools).not.toContain("read_file");
      expect(exposedTools).not.toContain("search_code");
      expect(exposedTools).not.toContain("list_directory");
      expect(exposedTools).not.toContain("git_status");
      const prefetchedPaths = (firstRequest.messages ?? [])
        .flatMap((message) => message.tool_calls ?? [])
        .map((toolCall) => {
          try {
            return JSON.parse(toolCall.function?.arguments ?? "{}").path;
          } catch {
            return undefined;
          }
        })
        .filter((value): value is string => typeof value === "string");
      expect(prefetchedPaths).toEqual([relativePath]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("moves a direct Arabic read-then-propose request to pendingChanges without a prior plan", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-compound-write-"));
    const relativePath = "artifacts/dashboard/src/App.tsx";
    const absolutePath = path.join(rootPath, relativePath);
    const originalContent = "export const enabled = true;\n";
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, originalContent, "utf8");

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "compound-replace-1",
              type: "function",
              function: {
                name: "replace_text",
                arguments: JSON.stringify({
                  path: relativePath,
                  old_text: "export const enabled = true;",
                  new_text: "export const enabled = false;",
                  reason: "اقتراح تغيير معلّق بعد قراءة المصدر",
                }),
              },
            }, {
              id: "compound-search-after-replace-1",
              type: "function",
              function: {
                name: "search_code",
                arguments: JSON.stringify({
                  query: "enabled",
                  path: "artifacts/dashboard/src",
                }),
              },
            }],
          },
        }],
        model: "compound-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              response: "تم إنشاء التغيير المقترح للمراجعة.",
              sources: [relativePath],
            }),
          },
        }],
        model: "compound-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: string[] = [];
      const result = await chat({
        message:
          "اقرأ artifacts/dashboard/src/App.tsx، ثم أنشئ تغييرًا معلّقًا آمنًا لإيقاف enabled دون تطبيقه أو تشغيل الاختبارات.",
        history: [],
        projectContext: makeContext(),
        rootPath,
        onStep: (step) => {
          if (step.kind === "tool_call") steps.push(step.tool);
        },
      });

      expect(result.pendingChanges).toHaveLength(1);
      expect(result.pendingChanges[0]?.path).toBe(relativePath);
      expect(result.pendingChanges[0]?.newContent).toContain("enabled = false");
      // The first entry is the server-owned speculative read; the model then
      // advances directly to the pending proposal.
      expect(steps).toEqual(["read_file", "replace_text"]);
      expect(await fs.readFile(absolutePath, "utf8")).toBe(originalContent);

      const firstRequest = create.mock.calls[0]?.[0] as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      const exposedTools = (firstRequest.tools ?? []).map((tool) => tool.function?.name);
      expect(exposedTools).toContain("replace_text");
      expect(exposedTools).toContain("write_file");
      expect(exposedTools).not.toContain("run_validation");
      const synthesisRequest = create.mock.calls[1]?.[0] as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      expect(synthesisRequest.tools ?? []).toHaveLength(0);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not re-enter implementation planning for an approved Build handoff", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-build-handoff-"));
    const relativePath = "target.ts";
    const absolutePath = path.join(rootPath, relativePath);
    const originalContent = "export const enabled = true;\n";
    await fs.writeFile(absolutePath, originalContent, "utf8");

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "read-1",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: relativePath }) },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "replace-1",
              type: "function",
              function: {
                name: "replace_text",
                arguments: JSON.stringify({
                  path: relativePath,
                  old_text: "export const enabled = true;",
                  new_text: "export const enabled = false;",
                  reason: "Apply the approved implementation plan",
                }),
              },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"response":"Build proposal ready.","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: string[] = [];
      const result = await chat({
        message: [
          "Build the approved implementation plan.",
          "BUILD HANDOFF — execute only the approved implementation plan below.",
          '{"kind":"IMPLEMENTATION_PLAN_RESULT","approvalStatus":"APPROVED"}',
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        buildHandoff: true,
        onStep: (step) => {
          if (step.kind === "tool_call") steps.push(step.tool);
        },
      });

      expect(result.taskResult?.kind).not.toBe("IMPLEMENTATION_PLAN_RESULT");
      expect(result.pendingChanges).toHaveLength(1);
      expect(result.pendingChanges[0]?.path).toBe(relativePath);
      expect(result.pendingChanges[0]?.newContent).toContain("enabled = false");
      expect(steps).toEqual(["replace_text"]);
      expect(create).toHaveBeenCalledTimes(3);
      expect(await fs.readFile(absolutePath, "utf8")).toBe(originalContent);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("transitions a persisted execution node only after server-owned validation passes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-node-transition-"));
    const relativePath = "target.ts";
    await fs.writeFile(path.join(rootPath, relativePath), "export const enabled = true;\n", "utf8");

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "replace-1",
              type: "function",
              function: {
                name: "replace_text",
                arguments: JSON.stringify({
                  path: relativePath,
                  old_text: "export const enabled = true;",
                  new_text: "export const enabled = false;",
                  reason: "Apply the verified Repair Plan change",
                }),
              },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "validate-1",
              type: "function",
              function: {
                name: "run_validation",
                arguments: JSON.stringify({ profile: "workspace-typecheck" }),
              },
            }],
          },
        }],
        model: "handoff-model",
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"response":"Validated change queued for review.","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const { buildActiveTaskExecutionPlan } = await import("../task-session-state.js");
      const repairPlan = [{
        findingId: "F-01",
        files: [relativePath],
        steps: ["Update the enabled flag"],
        validationProfile: "workspace-typecheck" as const,
        verdictScope: "PRODUCTION" as const,
        scopedFindingStatus: "PRODUCTION_PROVEN" as const,
      }];
      const executionPlan = buildActiveTaskExecutionPlan({
        repairPlan,
        projectId: "project-1",
        rootPath,
      });
      expect(executionPlan).not.toBeNull();

      const executionNodes: string[][] = [];
      const validationRunner = vi.fn(async () => ({
        status: "passed" as const,
        profile: "workspace-typecheck",
        command: "pnpm typecheck",
        exitCode: 0,
      }));
      const now = new Date().toISOString();
      const result = await chat({
        message: "Execute Repair Plan",
        history: [{ role: "user", content: "Audit the target" }],
        projectContext: makeContext(),
        rootPath,
        projectId: "project-1",
        activeTaskState: {
          version: 1,
          taskType: "REPAIR_ANALYSIS",
          outputContract: "REPAIR_PLAN",
          contextProfile: "chat-normal",
          scope: { projectId: "project-1", rootPath, linkedTaskId: null },
          evidence: { readFiles: [] },
          executionPlan,
          startedAt: now,
          lastProgressAt: now,
        },
        allowValidationTools: true,
        approvalState: "APPROVED",
        approvedFilePaths: [relativePath],
        approvedValidationProfiles: ["workspace-typecheck"],
        validationRunner,
        validationTargetPaths: [relativePath],
        onExecutionNodes: (nodes) => {
          executionNodes.push(nodes.map((node) => `${node.id}:${node.status}:${node.attempts}`));
        },
      });

      const nodeId = executionPlan!.nodes[0]!.id;
      expect(validationRunner).toHaveBeenCalledWith(
        "workspace-typecheck",
        [relativePath],
        undefined,
        expect.any(Array),
      );
      expect(result.pendingChanges).toHaveLength(1);
      expect(executionNodes).toContainEqual([`${nodeId}:running:1`]);
      expect(executionNodes).toContainEqual([`${nodeId}:passed:1`]);
      expect(executionNodes.at(-1)).toEqual([`${nodeId}:passed:1`]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("retries a node after behavioral proof failure before exposing review readiness", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-proof-retry-"));
    const relativePath = "target.ts";
    await fs.writeFile(path.join(rootPath, relativePath), "export const enabled = true;\n", "utf8");

    let callIndex = 0;
    const create = vi.fn(async () => {
      const step = callIndex++ % 3;
      if (step === 0) {
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `replace-${callIndex}`,
                type: "function",
                function: {
                  name: "replace_text",
                  arguments: JSON.stringify({
                    path: relativePath,
                    old_text: "export const enabled = true;",
                    new_text: "export const enabled = false;",
                    reason: "Apply the verified Repair Plan change",
                  }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      if (step === 1) {
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `validate-${callIndex}`,
                type: "function",
                function: {
                  name: "run_validation",
                  arguments: JSON.stringify({ profile: "workspace-typecheck" }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      return {
        choices: [{ message: { content: '{"response":"Validated change queued for review.","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      };
    });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const { buildActiveTaskExecutionPlan } = await import("../task-session-state.js");
      const executionPlan = buildActiveTaskExecutionPlan({
        repairPlan: [{
          findingId: "F-01",
          files: [relativePath],
          steps: ["Update the enabled flag"],
          validationProfile: "workspace-typecheck",
          verdictScope: "PRODUCTION",
          scopedFindingStatus: "PRODUCTION_PROVEN",
        }],
        projectId: "project-1",
        rootPath,
      });
      const now = new Date().toISOString();
      const validationRunner = vi.fn(async () => ({
        status: "passed" as const,
        profile: "workspace-typecheck",
        command: "pnpm typecheck",
        exitCode: 0,
      }));
      let proofCalls = 0;
      const executionProofRunner = vi.fn(async () => ({
        status: (++proofCalls === 1 ? "failed" : "passed") as "failed" | "passed",
        code: proofCalls === 1 ? "INVARIANT_NOT_PROVEN" : undefined,
        detail: proofCalls === 1 ? "The implementation does not satisfy the full invariant." : undefined,
      }));

      const result = await chat({
        message: "Execute Repair Plan",
        history: [{ role: "user", content: "Audit the target" }],
        projectContext: makeContext(),
        rootPath,
        projectId: "project-1",
        activeTaskState: {
          version: 1,
          taskType: "REPAIR_ANALYSIS",
          outputContract: "REPAIR_PLAN",
          contextProfile: "chat-normal",
          scope: { projectId: "project-1", rootPath, linkedTaskId: null },
          evidence: { readFiles: [] },
          executionPlan,
          startedAt: now,
          lastProgressAt: now,
        },
        allowValidationTools: true,
        approvalState: "APPROVED",
        approvedFilePaths: [relativePath],
        approvedValidationProfiles: ["workspace-typecheck"],
        validationRunner,
        validationTargetPaths: [relativePath],
        executionProofRunner,
      });

      expect(proofCalls).toBe(2);
      expect(executionProofRunner).toHaveBeenCalledTimes(2);
      expect(validationRunner).toHaveBeenCalledTimes(2);
      expect(result.pendingChanges).toHaveLength(1);
      expect(result.pendingChanges[0]?.newContent).toContain("enabled = false");
      expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toBe(
        "export const enabled = true;\n",
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("runs independent approved phases through isolated coordinator loops", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-coordinated-handoff-"));
    const paths = ["one.ts", "two.ts"];
    await Promise.all(
      paths.map((relativePath, index) =>
        fs.writeFile(
          path.join(rootPath, relativePath),
          `export const value = ${index + 1};\n`,
          "utf8",
        ),
      ),
    );

    const callsByPath = new Map<string, number>();
    const create = vi.fn(async (request: {
      messages?: Array<{ role?: string; content?: unknown }>;
    }) => {
      const nodeSystemContent = request.messages?.find(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("[EXECUTION NODE"),
      )?.content;
      const relativePath =
        (typeof nodeSystemContent === "string"
          ? /Allowed files: ([^\n]+)/.exec(nodeSystemContent)?.[1]
          : undefined) ?? paths[0]!;
      const callNumber = callsByPath.get(relativePath) ?? 0;
      callsByPath.set(relativePath, callNumber + 1);

      if (callNumber === 0) {
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `replace-${relativePath}`,
                type: "function",
                function: {
                  name: "replace_text",
                  arguments: JSON.stringify({
                    path: relativePath,
                    old_text: `export const value = ${relativePath === "one.ts" ? "1" : "2"};`,
                    new_text: `export const value = ${relativePath === "one.ts" ? "10" : "20"};`,
                    reason: "Apply the approved scoped phase",
                  }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      if (callNumber === 1) {
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `validate-${relativePath}`,
                type: "function",
                function: {
                  name: "run_validation",
                  arguments: JSON.stringify({ profile: "workspace-typecheck" }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      return {
        choices: [{
          message: { content: '{"response":"Validated phase queued for review.","sources":[]}' },
        }],
        model: "handoff-model",
        usage: {},
      };
    });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const { buildActiveTaskExecutionPlan } = await import("../task-session-state.js");
      const repairPlan = paths.map((relativePath, index) => ({
        findingId: `F-0${index + 1}`,
        files: [relativePath],
        steps: [`Update ${relativePath}`],
        validationProfile: "workspace-typecheck" as const,
        verdictScope: "PRODUCTION" as const,
        scopedFindingStatus: "PRODUCTION_PROVEN" as const,
      }));
      const executionPlan = buildActiveTaskExecutionPlan({
        repairPlan,
        projectId: "project-1",
        rootPath,
      });
      expect(executionPlan?.nodes).toHaveLength(2);

      let activeValidations = 0;
      let maxActiveValidations = 0;
      const validationRunner = vi.fn(async () => {
        activeValidations += 1;
        maxActiveValidations = Math.max(maxActiveValidations, activeValidations);
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeValidations -= 1;
        return {
          status: "passed" as const,
          profile: "workspace-typecheck",
          command: "pnpm typecheck",
          exitCode: 0,
        };
      });
      const now = new Date().toISOString();
      const nodeSnapshots: string[][] = [];
      const result = await chat({
        message: "Execute Repair Plan",
        history: [{ role: "user", content: "Audit both targets" }],
        projectContext: makeContext(),
        rootPath,
        projectId: "project-1",
        activeTaskState: {
          version: 1,
          taskType: "REPAIR_ANALYSIS",
          outputContract: "REPAIR_PLAN",
          contextProfile: "chat-normal",
          scope: { projectId: "project-1", rootPath, linkedTaskId: null },
          evidence: { readFiles: [] },
          executionPlan: executionPlan!,
          startedAt: now,
          lastProgressAt: now,
        },
        allowValidationTools: true,
        approvalState: "APPROVED",
        approvedFilePaths: paths,
        approvedValidationProfiles: ["workspace-typecheck"],
        validationRunner,
        validationTargetPaths: paths,
        onExecutionNodes: (nodes) => {
          nodeSnapshots.push(nodes.map((node) => `${node.id}:${node.status}`));
        },
      });

      expect(result.pendingChanges).toHaveLength(2);
      expect(result.pendingChanges.map((change) => change.path).sort()).toEqual(paths);
      expect(validationRunner).toHaveBeenCalledTimes(2);
      expect(maxActiveValidations).toBe(2);
      expect(nodeSnapshots.at(-1)?.every((snapshot) => snapshot.endsWith(":passed"))).toBe(true);
      for (const relativePath of paths) {
        expect(await fs.readFile(path.join(rootPath, relativePath), "utf8")).toContain(
          relativePath === "one.ts" ? "value = 1" : "value = 2",
        );
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("retries one coordinated node with server-owned failure context while a sibling passes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-coordinated-retry-"));
    const paths = ["one.ts", "two.ts"];
    await Promise.all(
      paths.map((relativePath, index) =>
        fs.writeFile(
          path.join(rootPath, relativePath),
          `export const value = ${index + 1};\n`,
          "utf8",
        ),
      ),
    );

    const callsByPath = new Map<string, number>();
    const retrySystemPrompts: string[] = [];
    const create = vi.fn(async (request: {
      messages?: Array<{ role?: string; content?: unknown }>;
    }) => {
      const nodeSystemContent = request.messages?.find(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("[EXECUTION NODE"),
      )?.content;
      const relativePath =
        (typeof nodeSystemContent === "string"
          ? /Allowed files: ([^\n]+)/.exec(nodeSystemContent)?.[1]
          : undefined) ?? paths[0]!;
      const callNumber = callsByPath.get(relativePath) ?? 0;
      callsByPath.set(relativePath, callNumber + 1);
      if (callNumber === 3 && typeof nodeSystemContent === "string") {
        retrySystemPrompts.push(nodeSystemContent);
      }

      if (callNumber % 3 === 0) {
        const originalValue = relativePath === "one.ts" ? "1" : "2";
        const replacementValue =
          relativePath === "one.ts"
            ? (callNumber === 0 ? "10" : "11")
            : "20";
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `replace-${relativePath}-${callNumber}`,
                type: "function",
                function: {
                  name: "replace_text",
                  arguments: JSON.stringify({
                    path: relativePath,
                    old_text: `export const value = ${originalValue};`,
                    new_text: `export const value = ${replacementValue};`,
                    reason: "Apply the approved scoped phase",
                  }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      if (callNumber % 3 === 1) {
        return {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                id: `validate-${relativePath}-${callNumber}`,
                type: "function",
                function: {
                  name: "run_validation",
                  arguments: JSON.stringify({ profile: "workspace-typecheck" }),
                },
              }],
            },
          }],
          model: "handoff-model",
          usage: {},
        };
      }
      return {
        choices: [{
          message: { content: '{"response":"Validation result recorded.","sources":[]}' },
        }],
        model: "handoff-model",
        usage: {},
      };
    });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const { buildActiveTaskExecutionPlan } = await import("../task-session-state.js");
      const repairPlan = paths.map((relativePath, index) => ({
        findingId: `F-0${index + 1}`,
        files: [relativePath],
        steps: [`Update ${relativePath}`],
        validationProfile: "workspace-typecheck" as const,
        verdictScope: "PRODUCTION" as const,
        scopedFindingStatus: "PRODUCTION_PROVEN" as const,
      }));
      const executionPlan = buildActiveTaskExecutionPlan({
        repairPlan,
        projectId: "project-1",
        rootPath,
      });
      expect(executionPlan?.nodes).toHaveLength(2);
      executionPlan!.nodes[1]!.dependencies = [executionPlan!.nodes[0]!.id];

      const validationCallsByPath = new Map<string, number>();
      const validationRunner = vi.fn(async (
        _profile: string,
        targetPaths: string[],
      ) => {
        const relativePath = targetPaths[0]!;
        const callNumber = (validationCallsByPath.get(relativePath) ?? 0) + 1;
        validationCallsByPath.set(relativePath, callNumber);
        if (relativePath === "one.ts" && callNumber === 1) {
          return {
            status: "failed" as const,
            profile: "workspace-typecheck" as const,
            command: "pnpm typecheck",
            exitCode: 1,
            detail: "TS2345: value must be a number",
          };
        }
        return {
          status: "passed" as const,
          profile: "workspace-typecheck" as const,
          command: "pnpm typecheck",
          exitCode: 0,
        };
      });

      const now = new Date().toISOString();
      const nodeSnapshots: string[][] = [];
      const result = await chat({
        message: "Execute Repair Plan",
        history: [{ role: "user", content: "Audit both targets" }],
        projectContext: makeContext(),
        rootPath,
        projectId: "project-1",
        activeTaskState: {
          version: 1,
          taskType: "REPAIR_ANALYSIS",
          outputContract: "REPAIR_PLAN",
          contextProfile: "chat-normal",
          scope: { projectId: "project-1", rootPath, linkedTaskId: null },
          evidence: { readFiles: [] },
          executionPlan: executionPlan!,
          startedAt: now,
          lastProgressAt: now,
        },
        allowValidationTools: true,
        approvalState: "APPROVED",
        approvedFilePaths: paths,
        approvedValidationProfiles: ["workspace-typecheck"],
        validationRunner,
        validationTargetPaths: paths,
        onExecutionNodes: (nodes) => {
          nodeSnapshots.push(nodes.map((node) => `${node.id}:${node.status}:${node.attempts}`));
        },
      });

      expect(result.pendingChanges).toHaveLength(2);
      expect(result.pendingChanges.map((change) => change.path).sort()).toEqual(paths);
      expect(validationRunner).toHaveBeenCalledTimes(3);
      expect(validationCallsByPath).toEqual(new Map([
        ["one.ts", 2],
        ["two.ts", 1],
      ]));
      expect(retrySystemPrompts).toHaveLength(1);
      expect(retrySystemPrompts[0]).toContain("[PREVIOUS VALIDATION FAILURE — SERVER-OWNED DIAGNOSTIC]");
      expect(retrySystemPrompts[0]).toContain("TS2345: value must be a number");
      expect(nodeSnapshots.at(-1)).toEqual(expect.arrayContaining([
        expect.stringMatching(/phase:F-01:1:passed:2/),
        expect.stringMatching(/phase:F-02:2:passed:1/),
      ]));
      const firstNodePassedIndex = nodeSnapshots.findIndex((snapshot) =>
        snapshot.some((entry) => entry === "phase:F-01:1:passed:2"),
      );
      const secondNodeStartedIndex = nodeSnapshots.findIndex((snapshot) =>
        snapshot.some((entry) => entry === "phase:F-02:2:running:1"),
      );
      expect(firstNodePassedIndex).toBeGreaterThanOrEqual(0);
      expect(secondNodeStartedIndex).toBeGreaterThan(firstNodePassedIndex);
      expect(await fs.readFile(path.join(rootPath, "one.ts"), "utf8")).toContain("value = 1");
      expect(await fs.readFile(path.join(rootPath, "two.ts"), "utf8")).toContain("value = 2");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("blocks a fixture-local repair plan via the Repair Scope Gate before any tool runs", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-handoff-gate-"));
    const fixturePath = "src/__tests__/fixtures/known-defect.ts";
    const absolutePath = path.join(rootPath, fixturePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "export function run(input: string) { return eval(input); }\n", "utf8");

    const create = vi
      .fn()
      .mockResolvedValue({
        choices: [{ message: { content: '{"response":"should never be reached","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: Array<{ kind: string; tool?: string }> = [];
      const result = await chat({
        message: "نفذ Repair Plan",
        history: [
          { role: "user", content: "راجع الكود" },
          {
            role: "assistant",
            content: [
              "## 3) Findings",
              "* ID: F-01 · unsafe eval over untrusted input",
              `* File(s): \`${fixturePath}\``,
              "* Evidence: `return eval(input)`",
              "* Why it matters: untrusted input reaches eval",
              "* Root cause: eval used on a runtime value",
              "* Fix: replace eval with a safe parser",
              "## 4) Repair Plan",
              `Phase 1 (F-01): Replace eval with a safe parser — \`${fixturePath}\``,
            ].join("\n"),
          },
        ],
        projectContext: makeContext(),
        rootPath,
        onStep: (step) => {
          if (step.kind === "tool_call") {
            steps.push({ kind: step.kind, tool: step.tool });
          }
        },
      });

      // EI-036: a fixture-only plan is FIXTURE_PROVEN → the Repair Scope Gate
      // must block it BEFORE the tool loop. No tools, no writes, no changes.
      expect(steps).toHaveLength(0);
      expect(create).not.toHaveBeenCalled();
      expect(result.pendingChanges).toHaveLength(0);
      expect(await fs.readFile(absolutePath, "utf8")).toContain("eval(input)");
      // The message is Arabic, so the gate returns the Arabic block text. Both
      // the machine reason code and the "no tools run" promise are asserted.
      expect(result.response).toContain("REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION");
      expect(result.response).toContain("بوابة نطاق الإصلاح");
      expect(result.response).toContain("لم تُشغّل أدوات");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("task #46: restores the persisted verdict scope from the recovered plan metadata instead of re-deriving from paths", async () => {
    // The plan's target file is a plain PRODUCTION-looking path. A fresh
    // deriveScopedFindingStatusFromPaths would classify it PRODUCTION_PROVEN
    // (which the Repair Scope Gate ALLOWS). But the plan was issued under a
    // persisted FIXTURE_PROVEN verdict scope (from the prior audit's final
    // runtime ledger, stamped onto repairPlanMetadata). Task #46 requires the
    // execution gate to restore that SAME scope and block — never re-derive a
    // fresh default that whitelists the edit.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-handoff-restore-"));
    const plainPath = "src/target.ts";
    const absolutePath = path.join(rootPath, plainPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, "export const flag = true;\n", "utf8");

    const create = vi
      .fn()
      .mockResolvedValue({
        choices: [{ message: { content: '{"response":"should never be reached","sources":[]}' } }],
        model: "handoff-model",
        usage: {},
      });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = { completions: { create } };
      },
    }));

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: Array<{ kind: string; tool?: string }> = [];
      const result = await chat({
        message: "نفذ Repair Plan",
        history: [
          { role: "user", content: "راجع الكود" },
          {
            role: "assistant",
            content: [
              "## 3) Findings",
              "* ID: F-01 · HIGH",
              `* File(s): \`${plainPath}\``,
              "* Evidence: `export const flag = true`",
              "* Why it matters: the flag is incorrect",
              "* Root cause: incorrect configuration",
              "* Fix: update the flag",
              "## 4) Repair Plan",
              `Phase 1 (F-01): Update the verified implementation — \`${plainPath}\``,
            ].join("\n"),
            // Persisted scope from the prior audit's repairPlanMetadata.
            repairPlan: [
              {
                findingId: "F-01",
                files: [plainPath],
                steps: ["Update the flag to false"],
                validationProfile: "knowledge-engine-tests",
                verdictScope: "FIXTURE_LOCAL",
                scopedFindingStatus: "FIXTURE_PROVEN",
              },
            ],
          },
        ],
        projectContext: makeContext(),
        rootPath,
        onStep: (step) => {
          if (step.kind === "tool_call") {
            steps.push({ kind: step.kind, tool: step.tool });
          }
        },
      });

      // The path alone would read as PRODUCTION_PROVEN, but the persisted
      // FIXTURE_PROVEN scope must win: the Repair Scope Gate restores it and
      // blocks before the tool loop. No tools, no writes, no changes.
      expect(steps).toHaveLength(0);
      expect(create).not.toHaveBeenCalled();
      expect(result.pendingChanges).toHaveLength(0);
      expect(result.response).toContain("REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});