import { previewBuildJobStatusEnum } from "@workspace/db";
import { z } from "zod/v4";

export type PreviewBuildJobStatus =
  (typeof previewBuildJobStatusEnum.enumValues)[number];

const transitions: Record<
  PreviewBuildJobStatus,
  readonly PreviewBuildJobStatus[]
> = {
  queued: ["launching", "failed", "expired", "cancelled"],
  launching: ["running", "failed", "expired", "cancelled"],
  running: ["builder_succeeded", "failed", "expired", "cancelled"],
  builder_succeeded: ["verified", "failed", "expired"],
  verified: [],
  failed: [],
  expired: [],
  cancelled: [],
};

const taskArnSchema = z
  .string()
  .regex(
    /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i,
  );
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const idSchema = z.string().uuid();
const failureCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/);

export class PreviewBuildJobStateError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_JOB_TRANSITION_INVALID"
      | "PREVIEW_BUILD_JOB_TRANSITION_DATA_INVALID",
  ) {
    super("Preview build job state transition was rejected.");
    this.name = "PreviewBuildJobStateError";
  }
}

export function assertPreviewBuildJobTransition(
  from: PreviewBuildJobStatus,
  to: PreviewBuildJobStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new PreviewBuildJobStateError("PREVIEW_BUILD_JOB_TRANSITION_INVALID");
  }
}

export type PreviewBuildJobTransitionData = {
  builderTaskArn?: string;
  outputDigest?: string;
  buildReceiptId?: string;
  failureCode?: string;
};

export function assertPreviewBuildJobTransitionData(
  status: PreviewBuildJobStatus,
  data: PreviewBuildJobTransitionData,
): void {
  const allowedFields: Record<PreviewBuildJobStatus, readonly string[]> = {
    queued: [],
    launching: [],
    running: ["builderTaskArn"],
    builder_succeeded: ["builderTaskArn", "outputDigest"],
    verified: ["builderTaskArn", "outputDigest", "buildReceiptId"],
    failed: ["failureCode"],
    expired: [],
    cancelled: [],
  };
  const hasUnexpectedFields = Object.entries(data).some(
    ([key, value]) =>
      value !== undefined && !allowedFields[status].includes(key),
  );
  const valid =
    !hasUnexpectedFields &&
    (status !== "running" ||
      (typeof data.builderTaskArn === "string" &&
        taskArnSchema.safeParse(data.builderTaskArn).success)) &&
    (status !== "builder_succeeded" ||
      (typeof data.builderTaskArn === "string" &&
        taskArnSchema.safeParse(data.builderTaskArn).success &&
        typeof data.outputDigest === "string" &&
        digestSchema.safeParse(data.outputDigest).success)) &&
    (status !== "verified" ||
      (typeof data.builderTaskArn === "string" &&
        taskArnSchema.safeParse(data.builderTaskArn).success &&
        typeof data.outputDigest === "string" &&
        digestSchema.safeParse(data.outputDigest).success &&
        typeof data.buildReceiptId === "string" &&
        idSchema.safeParse(data.buildReceiptId).success)) &&
    (status !== "failed" ||
      (typeof data.failureCode === "string" &&
        failureCodeSchema.safeParse(data.failureCode).success));

  if (!valid) {
    throw new PreviewBuildJobStateError(
      "PREVIEW_BUILD_JOB_TRANSITION_DATA_INVALID",
    );
  }
}
