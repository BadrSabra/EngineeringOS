import { describe, expect, it } from "vitest";
import { createToolInvocationEpisodeEventInput } from "./tool-invocation-episode-event.js";

const baseInvocation = {
  phase: "completed" as const,
  toolCallId: "provider-call-17",
  executionId: "tool-loop-execution",
  scopeHash: "c".repeat(64),
  toolName: "read_file",
  inputHash: "a".repeat(64),
  manifestHash: "b".repeat(64),
  outputHash: "d".repeat(64),
};

const baseBinding = {
  episodeId: "episode-1",
  projectId: "project-1",
  executionId: "durable-execution-1",
  attempt: 3,
  workerId: "worker-1",
  projectRevision: "revision-7",
  correlationId: "operation-1",
};

describe("tool invocation Episode event contract", () => {
  it("stores bound lifecycle metadata and hashes without raw tool arguments", () => {
    const event = createToolInvocationEpisodeEventInput({
      ...baseBinding,
      invocation: baseInvocation,
    });

    expect(event).toMatchObject({
      episodeId: "episode-1",
      projectId: "project-1",
      executionId: "durable-execution-1",
      attempt: 3,
      workerId: "worker-1",
      eventType: "TOOL_INVOCATION_RECORDED",
      payload: {
        toolLoopExecutionId: "tool-loop-execution",
        toolCallId: "provider-call-17",
        toolName: "read_file",
        phase: "completed",
        inputHash: "a".repeat(64),
        manifestHash: "b".repeat(64),
        scopeHash: "c".repeat(64),
        outputHash: "d".repeat(64),
        projectRevision: "revision-7",
      },
    });
    expect(event.payload).toMatchObject({
      invocationId: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(event)).not.toContain("src/private.ts");
  });

  it("changes invocation identity across durable attempts and rejects incomplete bindings", () => {
    const first = createToolInvocationEpisodeEventInput({
      ...baseBinding,
      invocation: baseInvocation,
    });
    const nextAttempt = createToolInvocationEpisodeEventInput({
      ...baseBinding,
      attempt: 4,
      invocation: baseInvocation,
    });
    expect(first.payload).not.toMatchObject({
      invocationId: (nextAttempt.payload as { invocationId: string }).invocationId,
    });

    expect(() => createToolInvocationEpisodeEventInput({
      ...baseBinding,
      invocation: { ...baseInvocation, scopeHash: undefined },
    })).toThrow("tool_invocation_lifecycle_identity_invalid");
  });
});