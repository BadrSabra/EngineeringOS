import { previewSessionStatusEnum } from "@workspace/db";

export type PreviewSessionStatus =
  (typeof previewSessionStatusEnum.enumValues)[number];

const allowedTransitions: Record<
  PreviewSessionStatus,
  readonly PreviewSessionStatus[]
> = {
  starting: ["ready", "stopping", "failed", "expired"],
  ready: ["stopping", "failed", "expired"],
  stopping: ["stopped", "failed", "expired"],
  stopped: [],
  failed: [],
  expired: [],
};

export class PreviewSessionTransitionError extends Error {
  constructor(
    readonly from: PreviewSessionStatus,
    readonly to: PreviewSessionStatus,
  ) {
    super(`Preview session cannot transition from ${from} to ${to}.`);
    this.name = "PreviewSessionTransitionError";
  }
}

export function assertPreviewSessionTransition(
  from: PreviewSessionStatus,
  to: PreviewSessionStatus,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new PreviewSessionTransitionError(from, to);
  }
}
