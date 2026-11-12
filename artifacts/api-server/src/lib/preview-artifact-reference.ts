import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PreviewArtifactRole = "input" | "output";

/**
 * Derive a stable, job-owned artifact reference. A retry of one job reuses its
 * reference; another job gets a distinct reference even when it shares bytes.
 */
export function previewBuildArtifactRefId(
  jobId: string,
  role: PreviewArtifactRole,
): string {
  if (!UUID_PATTERN.test(jobId)) {
    throw new Error("Preview artifact job identity is invalid.");
  }
  const bytes = createHash("sha256")
    .update("EngineeringOS Preview Job Artifact Reference v1\n")
    .update(role, "utf8")
    .update("\n")
    .update(jobId.toLowerCase(), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
