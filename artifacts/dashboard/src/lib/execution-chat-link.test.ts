import { describe, expect, it } from "vitest";
import { executionChatHref } from "./execution-chat-link";

describe("executionChatHref", () => {
  it("creates a project-scoped link for the selected execution session", () => {
    expect(executionChatHref(
      {
        id: "execution-1",
        projectId: "project-1",
        sessionId: "session/1",
      },
      "execution-1",
      "project-1",
    )).toBe("/ai?projectId=project-1&sessionId=session%2F1");
  });

  it("rejects missing sessions and mismatched execution or project identities", () => {
    expect(executionChatHref(
      { id: "execution-1", projectId: "project-1" },
      "execution-1",
      "project-1",
    )).toBeNull();
    expect(executionChatHref(
      { id: "execution-1", projectId: "project-1", sessionId: "session-1" },
      "execution-2",
      "project-1",
    )).toBeNull();
    expect(executionChatHref(
      { id: "execution-1", projectId: "another-project", sessionId: "session-1" },
      "execution-1",
      "project-1",
    )).toBeNull();
  });
});
