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

import { evaluateRetryWindowAtDatabaseTime, runChatExecutionRecovery } from "./chat-recovery-runner.js";

describe("Chat retry window database clock", () => {
  const databaseNow = Date.parse("2026-11-19T12:00:00.000Z");

  it("does not treat an API host clock ahead of PostgreSQL as permission to retry early", () => {
    const retryAt = "2026-11-19T12:05:00.000Z";
    const apiHostNow = databaseNow + 60 * 60 * 1000;

    expect(apiHostNow).toBeGreaterThan(Date.parse(retryAt));
    expect(evaluateRetryWindowAtDatabaseTime(retryAt, databaseNow)).toBe("not_due");
  });

  it("allows retry only when the database clock reaches the persisted deadline", () => {
    const retryAt = "2026-11-19T12:05:00.000Z";

    expect(evaluateRetryWindowAtDatabaseTime(retryAt, Date.parse(retryAt) - 1)).toBe("not_due");
    expect(evaluateRetryWindowAtDatabaseTime(retryAt, Date.parse(retryAt))).toBe("due");
  });

  it("fails closed for malformed retry metadata or an invalid database clock", () => {
    expect(evaluateRetryWindowAtDatabaseTime("not-a-date", databaseNow)).toBe("invalid");
    expect(evaluateRetryWindowAtDatabaseTime(123, databaseNow)).toBe("invalid");
    expect(evaluateRetryWindowAtDatabaseTime(undefined, Number.NaN)).toBe("invalid");
  });
});

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
