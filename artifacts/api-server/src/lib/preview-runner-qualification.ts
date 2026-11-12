import { z } from "zod/v4";

const qualificationRecordSchema = z
  .object({
    qualificationRecordId: z.string().uuid(),
    agentVersion: z.string().min(1).max(128),
    sandboxProviderId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    sandboxRuntimeVersion: z.string().min(1).max(128),
    isolationClass: z.enum(["syscall_sandbox", "microvm"]),
    runtimeProfileDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    sandboxPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    evidenceMode: z.literal("local_observed"),
  })
  .strict();

export type PreviewRunnerQualificationRecordV1 = z.infer<
  typeof qualificationRecordSchema
>;

export class PreviewRunnerQualificationRegistryError extends Error {
  constructor(
    readonly code:
      | "RUNNER_QUALIFICATION_INVALID"
      | "RUNNER_QUALIFICATION_DUPLICATE",
  ) {
    super("Preview Runner qualification is unavailable.");
    this.name = "PreviewRunnerQualificationRegistryError";
  }
}

export function createPreviewRunnerQualificationRegistry(
  records: readonly unknown[],
) {
  const byId = new Map<string, PreviewRunnerQualificationRecordV1>();
  for (const value of records) {
    const parsed = qualificationRecordSchema.safeParse(value);
    if (!parsed.success) {
      throw new PreviewRunnerQualificationRegistryError(
        "RUNNER_QUALIFICATION_INVALID",
      );
    }
    if (byId.has(parsed.data.qualificationRecordId)) {
      throw new PreviewRunnerQualificationRegistryError(
        "RUNNER_QUALIFICATION_DUPLICATE",
      );
    }
    byId.set(
      parsed.data.qualificationRecordId,
      Object.freeze(parsed.data),
    );
  }

  const frozenRecords = Object.freeze([...byId.values()]);
  return Object.freeze({
    get(qualificationRecordId: string) {
      return byId.get(qualificationRecordId);
    },
    list() {
      return frozenRecords;
    },
  });
}

/**
 * Deliberately empty until a Runner runtime/policy has passed independent
 * qualification. A signed local capability report cannot populate this list.
 */
export const previewRunnerQualificationRegistry =
  createPreviewRunnerQualificationRegistry([]);
