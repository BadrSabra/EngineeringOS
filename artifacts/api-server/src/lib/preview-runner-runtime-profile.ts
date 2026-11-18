import {
  previewRuntimeProfileDigest,
  type PreviewRuntimeProfileV1,
} from "@workspace/preview-runner-contract";
import { z } from "zod/v4";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const profileSchema = z
  .object({
    profileId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i),
    version: z.number().int().positive().max(10_000),
    runtimeImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    launcherDigest: digestSchema,
    requiredIsolationClass: z.enum(["syscall_sandbox", "microvm"]),
    filesystemPolicyDigest: digestSchema,
    networkPolicyDigest: digestSchema,
    resourcePolicyDigest: digestSchema,
    exposureProtocol: z.literal("session_uds_v1"),
    qualificationRecordId: z.string().uuid(),
  })
  .strict();

export type PreviewRunnerRuntimeProfileRecordV1 = {
  profile: PreviewRuntimeProfileV1;
  digest: string;
};

export class PreviewRunnerRuntimeProfileRegistryError extends Error {
  constructor(
    readonly code:
      | "RUNNER_RUNTIME_PROFILE_INVALID"
      | "RUNNER_RUNTIME_PROFILE_DUPLICATE",
  ) {
    super("Preview Runner runtime profile is unavailable.");
    this.name = "PreviewRunnerRuntimeProfileRegistryError";
  }
}

export function createPreviewRunnerRuntimeProfileRegistry(
  records: readonly unknown[],
) {
  const byId = new Map<string, PreviewRunnerRuntimeProfileRecordV1>();
  const digestOwners = new Set<string>();

  for (const value of records) {
    const parsed = z
      .object({
        profile: profileSchema,
        digest: digestSchema,
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) {
      throw new PreviewRunnerRuntimeProfileRegistryError(
        "RUNNER_RUNTIME_PROFILE_INVALID",
      );
    }

    let expectedDigest: string;
    try {
      expectedDigest = previewRuntimeProfileDigest(parsed.data.profile);
    } catch {
      throw new PreviewRunnerRuntimeProfileRegistryError(
        "RUNNER_RUNTIME_PROFILE_INVALID",
      );
    }
    if (expectedDigest !== parsed.data.digest.toLowerCase()) {
      throw new PreviewRunnerRuntimeProfileRegistryError(
        "RUNNER_RUNTIME_PROFILE_INVALID",
      );
    }

    const profileId = parsed.data.profile.profileId;
    const digest = parsed.data.digest.toLowerCase();
    if (byId.has(profileId) || digestOwners.has(digest)) {
      throw new PreviewRunnerRuntimeProfileRegistryError(
        "RUNNER_RUNTIME_PROFILE_DUPLICATE",
      );
    }
    const frozen = Object.freeze({
      profile: Object.freeze(parsed.data.profile),
      digest,
    });
    byId.set(profileId, frozen);
    digestOwners.add(digest);
  }

  const frozenRecords = Object.freeze([...byId.values()]);
  return Object.freeze({
    get(profileId: string) {
      return byId.get(profileId);
    },
    list() {
      return frozenRecords;
    },
  });
}

/**
 * Kept empty until a runtime profile is backed by independent qualification.
 * Capability reports alone cannot add a profile.
 */
export const previewRunnerRuntimeProfileRegistry =
  createPreviewRunnerRuntimeProfileRegistry([]);
