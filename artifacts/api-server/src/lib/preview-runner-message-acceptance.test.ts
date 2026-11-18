import { describe, expect, it } from "vitest";
import type { PreviewRunnerMessageV1 } from "@workspace/preview-runner-contract";
import {
  PreviewRunnerMessageAcceptanceError,
  projectAcceptedRunnerMessage,
} from "./preview-runner-message-acceptance.js";

const common = {
  protocolVersion: 1 as const,
  messageId: "123e4567-e89b-42d3-a456-426614174000",
  keyId: "node-key-v1",
  nodeId: "node-1",
  commandId: "223e4567-e89b-42d3-a456-426614174001",
  idempotencyKey: "223e4567-e89b-42d3-a456-426614174001",
  sessionId: "323e4567-e89b-42d3-a456-426614174002",
  stateVersion: 1,
  executionGeneration: 1,
  fencingGeneration: 2,
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 4,
  baseRevision: "a".repeat(64),
  candidateRevision: "b".repeat(64),
  changeSetHash: "c".repeat(64),
  buildReceiptId: "423e4567-e89b-42d3-a456-426614174003",
  runtimeProfileDigest: "d".repeat(64),
  artifactDigest: "e".repeat(64),
  channelRef: "523e4567-e89b-42d3-a456-426614174004",
  issuedAt: "2031-03-04T12:00:00.000Z",
  expiresAt: "2031-03-04T12:00:20.000Z",
};

describe("accepted Runner message projection", () => {
  it("records a ready claim without promoting the Preview session to ready", () => {
    const message = {
      ...common,
      messageType: "observation",
      executionRef: "exec_abcdefghijklmnop",
      state: "ready",
      observedAt: common.issuedAt,
      evidence: {
        artifactDigest: common.artifactDigest,
        runtimeImageDigest: `sha256:${"f".repeat(64)}`,
        launcherDigest: "a".repeat(64),
        filesystemPolicyDigest: "b".repeat(64),
        networkPolicyDigest: "c".repeat(64),
        resourcePolicyDigest: "d".repeat(64),
        isolationEvidenceDigest: "e".repeat(64),
        channelRef: common.channelRef,
      },
      terminationConfirmed: false,
      channelClosed: false,
      cleanupConfirmed: false,
      failureCode: null,
    } as PreviewRunnerMessageV1;

    const update = projectAcceptedRunnerMessage({
      action: "observe",
      message,
      currentExecutionRef: message.executionRef,
    });

    expect(update.projection).toMatchObject({
      messageType: "observation",
      state: "ready",
      executionRef: message.executionRef,
    });
    expect(update.stateVersionIncrement).toBe(1);
    expect(update).not.toHaveProperty("status", "ready");
  });

  it("keeps an unknown start outcome retryable under the same command version", () => {
    const message = {
      ...common,
      messageType: "start_ack",
      status: "outcome_unknown",
      executionRef: null,
      appliedEvidence: null,
    } as PreviewRunnerMessageV1;

    const update = projectAcceptedRunnerMessage({
      action: "start",
      message,
      currentExecutionRef: null,
    });

    expect(update.executionRef).toBeNull();
    expect(update.stateVersionIncrement).toBe(0);
  });

  it("binds observations to the current execution and action", () => {
    const message = {
      ...common,
      messageType: "observation",
      executionRef: "exec_abcdefghijklmnop",
      state: "provisioning",
      observedAt: common.issuedAt,
      evidence: null,
      terminationConfirmed: null,
      channelClosed: null,
      cleanupConfirmed: null,
      failureCode: null,
    } as PreviewRunnerMessageV1;

    expect(() =>
      projectAcceptedRunnerMessage({
        action: "observe",
        message,
        currentExecutionRef: "exec_differentexecution",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PREVIEW_RUNNER_MESSAGE_CONFLICT",
      }),
    );
    expect(() =>
      projectAcceptedRunnerMessage({
        action: "stop",
        message,
        currentExecutionRef: message.executionRef,
      }),
    ).toThrowError(PreviewRunnerMessageAcceptanceError);
  });
});
