import { describe, expect, it } from "vitest";
import {
  isVerifiedPreviewRuntimeProfile,
  loadPreviewRuntimeProfile,
} from "./preview-runtime-profile.js";

const runtimeEnv = {
  PREVIEW_ECR_REPOSITORY_URI:
    "123456789012.dkr.ecr.us-east-1.amazonaws.com/engineeringos-preview-runtime",
  PREVIEW_RUNTIME_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
  PREVIEW_TASK_DEFINITION_ARN:
    "arn:aws:ecs:us-east-1:123456789012:task-definition/engineeringos-preview-static:7",
};

describe("fixed Preview runtime profile", () => {
  it("loads only a pinned server-owned runtime image and task definition", () => {
    const profile = loadPreviewRuntimeProfile(runtimeEnv);

    expect(profile).toEqual({
      imageDigest: runtimeEnv.PREVIEW_RUNTIME_IMAGE_DIGEST,
      taskDefinitionArn: runtimeEnv.PREVIEW_TASK_DEFINITION_ARN,
    });
    expect(isVerifiedPreviewRuntimeProfile(profile)).toBe(true);
    expect(isVerifiedPreviewRuntimeProfile({ ...profile })).toBe(false);
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("fails closed when runtime configuration is incomplete or crosses ECR identity", () => {
    for (const env of [
      {},
      { ...runtimeEnv, PREVIEW_RUNTIME_IMAGE_DIGEST: "latest" },
      {
        ...runtimeEnv,
        PREVIEW_TASK_DEFINITION_ARN:
          "arn:aws:ecs:us-east-1:999999999999:task-definition/preview:1",
      },
      {
        ...runtimeEnv,
        PREVIEW_TASK_DEFINITION_ARN:
          "arn:aws:ecs:eu-west-1:123456789012:task-definition/preview:1",
      },
    ]) {
      expect(() => loadPreviewRuntimeProfile(env)).toThrow(
        "Preview runtime is not configured with a pinned server-owned image.",
      );
    }
  });
});
