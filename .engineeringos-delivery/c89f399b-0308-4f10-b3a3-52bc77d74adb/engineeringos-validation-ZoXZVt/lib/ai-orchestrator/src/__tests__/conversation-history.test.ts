import { describe, expect, it } from "vitest";
import {
  buildConversationHistoryWindow,
  CONVERSATION_HISTORY_TURNS,
} from "../agents/chat-agent.js";

function message(role: "user" | "assistant", content: string) {
  return { role, content };
}

describe("conversation history window", () => {
  it("keeps a fixed number of complete turns instead of using request category depth", () => {
    const history = Array.from({ length: 30 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `message-${index}`),
    );

    const window = buildConversationHistoryWindow(history);

    expect(window.recentHistory).toHaveLength(CONVERSATION_HISTORY_TURNS * 2);
    expect(window.recentHistory[0]?.content).toBe("message-6");
    expect(window.recentHistory.at(-1)?.content).toBe("message-29");
  });

  it("summarizes both user and assistant messages outside the raw window", () => {
    const history = [
      message("user", "The project uses a shared auth middleware."),
      message("assistant", "The decision is to keep auth at the API boundary."),
      ...Array.from({ length: CONVERSATION_HISTORY_TURNS * 2 }, (_, index) =>
        message(index % 2 === 0 ? "user" : "assistant", `recent-${index}`),
      ),
    ];

    const window = buildConversationHistoryWindow(history);
    const summary = window.episodeSummaryMessage?.content ?? "";

    expect(summary).toContain("User: The project uses a shared auth middleware.");
    expect(summary).toContain("Assistant: The decision is to keep auth at the API boundary.");
    expect(summary).toContain("both roles");
  });

  it("remains stateless when explicitly given a zero-turn window", () => {
    const history = [
      message("user", "old question"),
      message("assistant", "old answer"),
    ];

    const window = buildConversationHistoryWindow(history, 0);

    expect(window.recentHistory).toEqual([]);
    expect(window.episodeSummaryMessage).toBeNull();
  });
});