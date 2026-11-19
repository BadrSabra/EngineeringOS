import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({
  getAiExecutionForUser: vi.fn(),
  hasAiExecutionResumeContract: vi.fn(),
  parseExecutionRequest: vi.fn(),
  recoverAiExecutionRetryToken: vi.fn(),
  recoverAiExecutionResumeToken: vi.fn(),
}));

const chatMocks = vi.hoisted(() => ({
  finalizeChatRecoveryExhaustion: vi.fn(),
  handleChatStream: vi.fn(),
}));

vi.mock("./ai-execution-state.js", () => stateMocks);
vi.mock("../routes/ai/chat.js", () => chatMocks);

import { runChatExecutionRecovery } from "./chat-recovery-runner.js";

describe("runChatExecutionRecovery attempt binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a queued recovery when the execution has advanced beyond its captured attempt", async () => {
    stateMocks.getAiExecutionForUser.mockResolvedValueOnce({
      id: "execution-current",
      userId: "owner-current",
      attempt: 2,
      request: "{\"turnIntent\":\"CHAT\"}",
    } as never);

    const result = await runChatExecutionRecovery({
      executionId: "execution-current",
      userId: "owner-current",
      mode: "retry",
      expectedAttempt: 1,
    });

    expect(result).toEqual({ ok: false, reason: "execution_attempt_changed" });
    expect(stateMocks.parseExecutionRequest).not.toHaveBeenCalled();
    expect(stateMocks.recoverAiExecutionRetryToken).not.toHaveBeenCalled();
    expect(stateMocks.recoverAiExecutionResumeToken).not.toHaveBeenCalled();
    expect(chatMocks.handleChatStream).not.toHaveBeenCalled();
  });
});
