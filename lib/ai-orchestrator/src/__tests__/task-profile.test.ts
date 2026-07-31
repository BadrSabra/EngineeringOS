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
});
