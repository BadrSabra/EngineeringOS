import { describe, expect, it } from "vitest";
import { buildTaskProfile, inferTaskType } from "../quality/task-profile.js";
import { resolveExecutionDecision } from "../model-selection/decision-engine.js";

describe("task profile", () => {
  it("maps workflow scopes to workflow tasks", () => {
    expect(inferTaskType("workflow-orchestrator")).toBe("workflow");
    expect(buildTaskProfile("workflow-orchestrator").qualityProfile).toBe("workflow");
  });

  it("distinguishes chat agents with tools from plain chat", () => {
    expect(buildTaskProfile("chat-agent", { hasTools: true }).taskType).toBe("tool_chat");
    expect(buildTaskProfile("chat-agent").taskType).toBe("chat");
  });

  it("defaults unknown scopes to chat", () => {
    expect(buildTaskProfile("custom-scope").taskType).toBe("chat");
  });

  describe("context policy fields", () => {
    it("sets lite context for plain chat", () => {
      const p = buildTaskProfile("chat-agent");
      expect(p.contextIntensity).toBe("lite");
      expect(p.memoryMode).toBe("summary");
      expect(p.graphMode).toBe("index");
      expect(p.historyMode).toBe("recent");
    });

    it("sets normal context for tool_chat", () => {
      const p = buildTaskProfile("chat-agent", { hasTools: true });
      expect(p.contextIntensity).toBe("normal");
      expect(p.memoryMode).toBe("summary");
      expect(p.graphMode).toBe("index");
      expect(p.historyMode).toBe("recent");
    });

    it("sets deep context for analysis (scan)", () => {
      const p = buildTaskProfile("scan-runner");
      expect(p.contextIntensity).toBe("deep");
      expect(p.memoryMode).toBe("none");
      expect(p.graphMode).toBe("expanded");
      expect(p.historyMode).toBe("none");
    });

    it("sets deep context for code_review", () => {
      const p = buildTaskProfile("review-agent");
      expect(p.contextIntensity).toBe("deep");
      expect(p.memoryMode).toBe("none");
      expect(p.graphMode).toBe("expanded");
      expect(p.historyMode).toBe("none");
    });

    it("sets normal context with no memory for workflow", () => {
      const p = buildTaskProfile("workflow-orchestrator");
      expect(p.contextIntensity).toBe("normal");
      expect(p.memoryMode).toBe("none");
      expect(p.graphMode).toBe("index");
      expect(p.historyMode).toBe("none");
    });

    it("sets normal context with summarized history for task_execution", () => {
      const p = buildTaskProfile("task-runner");
      expect(p.contextIntensity).toBe("normal");
      expect(p.memoryMode).toBe("summary");
      expect(p.graphMode).toBe("index");
      expect(p.historyMode).toBe("summarized");
    });

    it("materializes the full policy on one execution plan", () => {
      const lite = resolveExecutionDecision("chat-agent");
      const deep = resolveExecutionDecision("scan-runner");
      const stateless = resolveExecutionDecision("workflow-orchestrator");

      expect(lite).toMatchObject({
        contextBudget: 3000,
        graphBudget: 800,
        historyDepth: 4,
        memoryDepth: 5,
        cacheMode: "aggressive",
      });
      expect(lite.contextSections).toEqual(
        expect.arrayContaining(["tasks", "graphEntities", "graphRelationships"]),
      );
      expect(deep).toMatchObject({
        contextBudget: 12000,
        graphBudget: 3200,
        historyDepth: 0,
        memoryDepth: 0,
        cacheMode: "bypass",
      });
      expect(deep.contextSections).toEqual(
        expect.arrayContaining(["tasks", "metrics", "events", "workflows"]),
      );
      expect(stateless.taskProfile.memoryMode).toBe("none");
      expect(stateless.taskProfile.historyMode).toBe("none");
    });

    it("keeps explicit policy overrides together", () => {
      const plan = resolveExecutionDecision("chat-agent", {
        contextIntensityOverride: "deep",
        memoryModeOverride: "none",
        graphModeOverride: "off",
        historyModeOverride: "none",
      });

      expect(plan.taskProfile).toMatchObject({
        contextIntensity: "deep",
        memoryMode: "none",
        graphMode: "off",
        historyMode: "none",
      });
      expect(plan.contextSections).not.toEqual(
        expect.arrayContaining(["graphEntities", "graphRelationships"]),
      );
      expect(plan.cacheMode).toBe("bypass");
    });
  });
});
