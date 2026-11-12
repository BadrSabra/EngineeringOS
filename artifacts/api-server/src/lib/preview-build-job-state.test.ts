import { describe, expect, it } from "vitest";
import {
  assertPreviewBuildJobTransition,
  assertPreviewBuildJobTransitionData,
  PreviewBuildJobStateError,
} from "./preview-build-job-state.js";

const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/preview/0123456789abcdef0123456789abcdef";
const outputDigest = "a".repeat(64);
const receiptId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";

describe("Preview build job lifecycle", () => {
  it("allows only the ordered build, verification, and terminal transitions", () => {
    for (const [from, to] of [
      ["queued", "launching"],
      ["launching", "running"],
      ["running", "builder_succeeded"],
      ["builder_succeeded", "verified"],
      ["running", "failed"],
      ["queued", "cancelled"],
      ["launching", "expired"],
    ] as const) {
      expect(() => assertPreviewBuildJobTransition(from, to)).not.toThrow();
    }

    for (const [from, to] of [
      ["queued", "running"],
      ["running", "verified"],
      ["verified", "running"],
      ["failed", "launching"],
      ["cancelled", "queued"],
    ] as const) {
      expect(() => assertPreviewBuildJobTransition(from, to)).toThrow(
        PreviewBuildJobStateError,
      );
    }
  });

  it("requires an ECS identity before reporting task progress", () => {
    expect(() => assertPreviewBuildJobTransitionData("running", {})).toThrow(
      expect.objectContaining({
        code: "PREVIEW_BUILD_JOB_TRANSITION_DATA_INVALID",
      }),
    );
    expect(() =>
      assertPreviewBuildJobTransitionData("running", {
        builderTaskArn: "arn:aws:ecs:untrusted",
      }),
    ).toThrow(PreviewBuildJobStateError);
    expect(() =>
      assertPreviewBuildJobTransitionData("launching", {
        builderTaskArn: taskArn,
      }),
    ).toThrow(PreviewBuildJobStateError);
  });

  it("does not equate Builder success with accepted verification", () => {
    expect(() =>
      assertPreviewBuildJobTransitionData("builder_succeeded", {
        builderTaskArn: taskArn,
      }),
    ).toThrow(PreviewBuildJobStateError);
    expect(() =>
      assertPreviewBuildJobTransitionData("verified", {
        builderTaskArn: taskArn,
        outputDigest,
      }),
    ).toThrow(PreviewBuildJobStateError);

    expect(() =>
      assertPreviewBuildJobTransitionData("verified", {
        builderTaskArn: taskArn,
        outputDigest,
        buildReceiptId: receiptId,
      }),
    ).not.toThrow();
  });

  it("stores only bounded failure codes, never raw task diagnostics", () => {
    expect(() =>
      assertPreviewBuildJobTransitionData("failed", {
        failureCode: "PREVIEW_BUILD_OUTPUT_INVALID",
      }),
    ).not.toThrow();
    expect(() =>
      assertPreviewBuildJobTransitionData("failed", {
        failureCode: "task failed: internal URL and secret",
      }),
    ).toThrow(PreviewBuildJobStateError);
  });
});
