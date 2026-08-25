import { describe, expect, it } from "vitest";
import { buildTaskProfile, inferTaskType } from "../quality/task-profile.js";

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
  });
});
