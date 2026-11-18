import { describe, expect, it } from "vitest";
import { PreviewRunnerCommandIssueError, planPreviewRunnerLease } from "./preview-runner-command-issuer.js";

const NOW = new Date("2031-03-04T12:00:00.000Z");
const OWNER_A = "123e4567-e89b-42d3-a456-426614174000";
const OWNER_B = "223e4567-e89b-42d3-a456-426614174001";
const COMMAND_A = "323e4567-e89b-42d3-a456-426614174002";
const COMMAND_B = "423e4567-e89b-42d3-a456-426614174003";
const PROOF_A = "a".repeat(64);
const PROOF_B = "b".repeat(64);

describe("durable Preview Runner lease planning", () => {
  it("increments the fence and creates one command for a fresh lease", () => {
    expect(
      planPreviewRunnerLease({
        action: "start",
        now: NOW,
        currentCommandId: null,
        currentFencingGeneration: 1,
        currentLeaseOwner: null,
        currentLeaseProofDigest: null,
        currentLeaseExpiresAt: null,
        requestedLeaseOwner: OWNER_A,
        requestedProofDigest: PROOF_A,
        acceptedMessageCommandId: null,
        acceptedMessageType: null,
        acceptedMessageStatus: null,
        nextCommandId: COMMAND_A,
      }),
    ).toEqual({
      commandId: COMMAND_A,
      fencingGeneration: 2,
      alreadyLeased: false,
    });
  });

  it("replays the same active lease without changing command or fence", () => {
    expect(
      planPreviewRunnerLease({
        action: "start",
        now: NOW,
        currentCommandId: COMMAND_A,
        currentFencingGeneration: 4,
        currentLeaseOwner: OWNER_A,
        currentLeaseProofDigest: PROOF_A,
        currentLeaseExpiresAt: new Date(NOW.getTime() + 10_000),
        requestedLeaseOwner: OWNER_A,
        requestedProofDigest: PROOF_A,
        acceptedMessageCommandId: null,
        acceptedMessageType: null,
        acceptedMessageStatus: null,
        nextCommandId: COMMAND_B,
      }),
    ).toEqual({
      commandId: COMMAND_A,
      fencingGeneration: 4,
      alreadyLeased: true,
    });
  });

  it("rejects another worker or another poll proof while the lease is live", () => {
    expect(() =>
      planPreviewRunnerLease({
        action: "start",
        now: NOW,
        currentCommandId: COMMAND_A,
        currentFencingGeneration: 4,
        currentLeaseOwner: OWNER_A,
        currentLeaseProofDigest: PROOF_A,
        currentLeaseExpiresAt: new Date(NOW.getTime() + 10_000),
        requestedLeaseOwner: OWNER_B,
        requestedProofDigest: PROOF_B,
        acceptedMessageCommandId: null,
        acceptedMessageType: null,
        acceptedMessageStatus: null,
      }),
    ).toThrowError(PreviewRunnerCommandIssueError);
    expect(() =>
      planPreviewRunnerLease({
        action: "start",
        now: NOW,
        currentCommandId: COMMAND_A,
        currentFencingGeneration: 4,
        currentLeaseOwner: OWNER_A,
        currentLeaseProofDigest: PROOF_A,
        currentLeaseExpiresAt: new Date(NOW.getTime() + 10_000),
        requestedLeaseOwner: OWNER_A,
        requestedProofDigest: PROOF_B,
        acceptedMessageCommandId: null,
        acceptedMessageType: null,
        acceptedMessageStatus: null,
      }),
    ).toThrowError(PreviewRunnerCommandIssueError);
  });

  it("retries an unaccepted or unknown start with the same idempotency identity", () => {
    const expiredLease = new Date(NOW.getTime() - 1);
    const unaccepted = planPreviewRunnerLease({
      action: "start",
      now: NOW,
      currentCommandId: COMMAND_A,
      currentFencingGeneration: 4,
      currentLeaseOwner: OWNER_A,
      currentLeaseProofDigest: PROOF_A,
      currentLeaseExpiresAt: expiredLease,
      requestedLeaseOwner: OWNER_B,
      requestedProofDigest: PROOF_B,
      acceptedMessageCommandId: null,
      acceptedMessageType: null,
      acceptedMessageStatus: null,
      nextCommandId: COMMAND_B,
    });
    const unknown = planPreviewRunnerLease({
      action: "start",
      now: NOW,
      currentCommandId: COMMAND_A,
      currentFencingGeneration: 4,
      currentLeaseOwner: null,
      currentLeaseProofDigest: null,
      currentLeaseExpiresAt: null,
      requestedLeaseOwner: OWNER_B,
      requestedProofDigest: PROOF_B,
      acceptedMessageCommandId: COMMAND_A,
      acceptedMessageType: "start_ack",
      acceptedMessageStatus: "outcome_unknown",
      nextCommandId: COMMAND_B,
    });

    expect(unaccepted.commandId).toBe(COMMAND_A);
    expect(unknown.commandId).toBe(COMMAND_A);
    expect(unaccepted.fencingGeneration).toBe(5);
    expect(unknown.fencingGeneration).toBe(5);
  });

  it("rotates the command after an accepted response and fences old workers", () => {
    expect(
      planPreviewRunnerLease({
        action: "observe",
        now: NOW,
        currentCommandId: COMMAND_A,
        currentFencingGeneration: 7,
        currentLeaseOwner: null,
        currentLeaseProofDigest: null,
        currentLeaseExpiresAt: null,
        requestedLeaseOwner: OWNER_B,
        requestedProofDigest: PROOF_B,
        acceptedMessageCommandId: COMMAND_A,
        acceptedMessageType: "start_ack",
        acceptedMessageStatus: "accepted",
        nextCommandId: COMMAND_B,
      }),
    ).toEqual({
      commandId: COMMAND_B,
      fencingGeneration: 8,
      alreadyLeased: false,
    });
  });
});
