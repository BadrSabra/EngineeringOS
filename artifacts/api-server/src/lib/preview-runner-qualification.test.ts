import { describe, expect, it } from "vitest";
import {
  createPreviewRunnerQualificationRegistry,
  PreviewRunnerQualificationRegistryError,
  previewRunnerQualificationRegistry,
  type PreviewRunnerQualificationRecordV1,
} from "./preview-runner-qualification.js";

const record: PreviewRunnerQualificationRecordV1 = {
  qualificationRecordId: "11111111-1111-4111-8111-111111111111",
  agentVersion: "1.2.3",
  sandboxProviderId: "gvisor",
  sandboxRuntimeVersion: "1.0.0",
  isolationClass: "syscall_sandbox",
  runtimeProfileDigest: "a".repeat(64),
  sandboxPolicyDigest: "b".repeat(64),
  evidenceMode: "local_observed",
};

describe("server-owned Preview Runner qualifications", () => {
  it("keeps the default registry empty until an environment is independently qualified", () => {
    expect(previewRunnerQualificationRegistry.list()).toEqual([]);
    expect(
      previewRunnerQualificationRegistry.get(record.qualificationRecordId),
    ).toBeUndefined();
  });

  it("returns an immutable exact qualification record", () => {
    const registry = createPreviewRunnerQualificationRegistry([record]);

    expect(registry.get(record.qualificationRecordId)).toEqual(record);
    expect(Object.isFrozen(registry.get(record.qualificationRecordId))).toBe(
      true,
    );
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it("rejects shared-kernel and malformed qualification records", () => {
    expect(() =>
      createPreviewRunnerQualificationRegistry([
        { ...record, isolationClass: "shared_kernel" },
      ]),
    ).toThrowError(PreviewRunnerQualificationRegistryError);

    expect(() =>
      createPreviewRunnerQualificationRegistry([
        { ...record, evidenceMode: "remote_attested" },
      ]),
    ).toThrowError(PreviewRunnerQualificationRegistryError);

    expect(() =>
      createPreviewRunnerQualificationRegistry([
        { ...record, unknownPolicy: true },
      ]),
    ).toThrowError(PreviewRunnerQualificationRegistryError);
  });

  it("rejects duplicate qualification identities", () => {
    expect(() =>
      createPreviewRunnerQualificationRegistry([record, record]),
    ).toThrowError(
      expect.objectContaining({
        code: "RUNNER_QUALIFICATION_DUPLICATE",
      }),
    );
  });
});
