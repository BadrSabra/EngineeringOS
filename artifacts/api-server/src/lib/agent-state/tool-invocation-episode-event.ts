import { createHash } from "node:crypto";
import type { ToolInvocationLifecycleEvent } from "@workspace/ai-orchestrator";
import type { AppendEpisodeEventInput } from "./agent-episode-ledger.js";

export function createToolInvocationEpisodeEventInput(input: {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  workerId: string;
  projectRevision: string;
  correlationId?: string;
  invocation: ToolInvocationLifecycleEvent;
}): AppendEpisodeEventInput {
  const invocation = input.invocation;
  const toolLoopExecutionId = invocation.executionId?.trim();
  const toolCallId = invocation.toolCallId?.trim();
  const toolName = invocation.toolName.trim();
  const scopeHash = invocation.scopeHash ?? "";
  if (
    !toolLoopExecutionId
    || !toolCallId
    || toolCallId.length > 160
    || !toolName
    || toolName.length > 160
    || !/^[a-f0-9]{64}$/u.test(invocation.inputHash)
    || !/^[a-f0-9]{64}$/u.test(invocation.manifestHash)
    || !/^[a-f0-9]{64}$/u.test(scopeHash)
    || (invocation.outputHash !== undefined
      && !/^[a-f0-9]{64}$/u.test(invocation.outputHash))
    || !input.projectRevision
    || input.projectRevision.length > 200
  ) {
    throw new Error("tool_invocation_lifecycle_identity_invalid");
  }
  const invocationId = createHash("sha256")
    .update([
      input.executionId,
      String(input.attempt),
      toolLoopExecutionId,
      toolCallId,
      toolName,
      invocation.inputHash,
      invocation.manifestHash,
      scopeHash,
    ].join("\0"), "utf8")
    .digest("hex");
  return {
    episodeId: input.episodeId,
    projectId: input.projectId,
    executionId: input.executionId,
    attempt: input.attempt,
    workerId: input.workerId,
    eventType: "TOOL_INVOCATION_RECORDED",
    payload: {
      invocationId,
      toolLoopExecutionId,
      toolCallId,
      toolName,
      phase: invocation.phase,
      inputHash: invocation.inputHash,
      manifestHash: invocation.manifestHash,
      scopeHash,
      projectRevision: input.projectRevision,
      ...(invocation.outputHash ? { outputHash: invocation.outputHash } : {}),
      ...(invocation.diagnosticCode
        ? { diagnosticCode: invocation.diagnosticCode.slice(0, 120) }
        : {}),
    },
    actorType: "worker",
    actorId: input.workerId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}