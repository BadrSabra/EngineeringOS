import { describe, expect, it } from "vitest";
import {
  previewRuntimeProfileDigest,
  type PreviewRuntimeProfileV1,
} from "@workspace/preview-runner-contract";
import {
  createPreviewRunnerRuntimeProfileRegistry,
  PreviewRunnerRuntimeProfileRegistryError,
} from "./preview-runner-runtime-profile.js";

const profile: PreviewRuntimeProfileV1 = {
  profileId: "isolated-vite-static",
  version: 1,
  runtimeImageDigest: `sha256:${"a".repeat(64)}`,
  launcherDigest: "b".repeat(64),
  requiredIsolationClass: "microvm",
  filesystemPolicyDigest: "c".repeat(64),
  networkPolicyDigest: "d".repeat(64),
  resourcePolicyDigest: "e".repeat(64),
  exposureProtocol: "session_uds_v1",
  qualificationRecordId: "123e4567-e89b-42d3-a456-426614174000",
};

describe("Preview Runner runtime profile registry", () => {
  it("is empty by default so an unqualified profile cannot become executable", () => {
    expect(createPreviewRunnerRuntimeProfileRegistry([]).list()).toEqual([]);
  });

  it("accepts only a digest-verified immutable profile", () => {
    const registry = createPreviewRunnerRuntimeProfileRegistry([
      { profile, digest: previewRuntimeProfileDigest(profile) },
    ]);

    expect(registry.get(profile.profileId)).toMatchObject({
      profile,
      digest: previewRuntimeProfileDigest(profile),
    });
    expect(Object.isFrozen(registry.get(profile.profileId)?.profile)).toBe(true);
  });

  it("rejects a profile whose claimed digest does not match its contents", () => {
    expect(() =>
      createPreviewRunnerRuntimeProfileRegistry([
        { profile, digest: "f".repeat(64) },
      ]),
    ).toThrowError(PreviewRunnerRuntimeProfileRegistryError);
  });

  it("rejects duplicate profile identity or digest", () => {
    const record = { profile, digest: previewRuntimeProfileDigest(profile) };
    expect(() =>
      createPreviewRunnerRuntimeProfileRegistry([record, record]),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_RUNTIME_PROFILE_DUPLICATE",
      }),
    );
  });
});
