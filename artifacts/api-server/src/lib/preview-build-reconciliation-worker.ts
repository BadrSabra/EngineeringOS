import { randomUUID } from "node:crypto";
import type { PreviewBuildJob } from "@workspace/db";
import { config } from "../config.js";
import {
  findPreviewBuildJobsToReconcile,
  transitionPreviewBuildJob,
} from "./preview-build-job-store.js";
import {
  observePreviewBuildJob,
  type PreviewBuildObservation,
} from "./preview-build-observation-client.js";
import { attestPreviewBuildJob } from "./preview-build-attestor-client.js";
import {
  acceptPreviewBuildReceipt,
  PreviewBuildAttestationError,
} from "./preview-build-attestor.js";

const MISSING_TASK_GRACE_MS = 2 * 60_000;
const RECONCILE_INTERVAL_MS = 20_000;
const ATTESTOR_TIMEOUT_MS = 30 * 60_000;
const MAX_JOBS_PER_PASS = 12;
const RECONCILE_CONCURRENCY = 3;
let reconciliationCursor: string | undefined = randomUUID();

type ReconciliationConfig = {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
  receiptPublicKeyPem?: string;
};

type ReconciliationDependencies = {
  now?: () => Date;
  listJobs?: typeof findPreviewBuildJobsToReconcile;
  observe?: typeof observePreviewBuildJob;
  attest?: typeof attestPreviewBuildJob;
  acceptReceipt?: typeof acceptPreviewBuildReceipt;
  transition?: typeof transitionPreviewBuildJob;
};

export type PreviewBuildReconciliationCounts = {
  inspected: number;
  advanced: number;
  failed: number;
  expired: number;
  awaitingOutput: number;
  unchanged: number;
};

async function applyObservation(input: {
  job: PreviewBuildJob;
  observation: PreviewBuildObservation;
  now: Date;
  transition: typeof transitionPreviewBuildJob;
}): Promise<"advanced" | "failed" | "awaitingOutput" | "unchanged"> {
  let job = input.job;
  let advanced = false;
  const observation = input.observation;
  if (
    job.builderTaskArn &&
    observation.taskArn &&
    job.builderTaskArn !== observation.taskArn
  ) {
    return "unchanged";
  }

  if (
    observation.state === "not_found" &&
    job.status === "launching" &&
    input.now.getTime() > job.tokenExpiresAt.getTime() + MISSING_TASK_GRACE_MS
  ) {
    const failed = await input.transition({
      jobId: job.jobId,
      expectedStatus: "launching",
      expectedVersion: job.stateVersion,
      nextStatus: "failed",
      failureCode: "BUILDER_TASK_NOT_FOUND",
      now: input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  if (
    job.status === "launching" &&
    observation.taskArn &&
    ["pending", "running", "stopped"].includes(observation.state)
  ) {
    const running = await input.transition({
      jobId: job.jobId,
      expectedStatus: "launching",
      expectedVersion: job.stateVersion,
      nextStatus: "running",
      builderTaskArn: observation.taskArn,
      now: input.now,
    });
    if (!running) return "unchanged";
    job = running;
    advanced = true;
  }

  if (job.status !== "running" || observation.state !== "stopped") {
    return advanced ? "advanced" : "unchanged";
  }
  if (!job.builderTaskArn || job.builderTaskArn !== observation.taskArn) {
    return "unchanged";
  }
  if (observation.exitCode === undefined || observation.exitCode !== 0) {
    const failed = await input.transition({
      jobId: job.jobId,
      expectedStatus: "running",
      expectedVersion: job.stateVersion,
      nextStatus: "failed",
      failureCode:
        observation.exitCode === undefined
          ? "BUILDER_EXIT_UNAVAILABLE"
          : "BUILDER_EXIT_NONZERO",
      now: input.now,
    });
    return failed ? "failed" : "unchanged";
  }
  if (observation.exitCode === 0 && observation.outputDigest) {
    const succeeded = await input.transition({
      jobId: job.jobId,
      expectedStatus: "running",
      expectedVersion: job.stateVersion,
      nextStatus: "builder_succeeded",
      builderTaskArn: job.builderTaskArn,
      outputDigest: observation.outputDigest,
      now: input.now,
    });
    return succeeded ? "advanced" : "unchanged";
  }
  return observation.exitCode === 0 ? "awaitingOutput" : "unchanged";
}

async function reconcileAttestation(input: {
  job: PreviewBuildJob;
  config: ReconciliationConfig;
  now: Date;
  attest: typeof attestPreviewBuildJob;
  acceptReceipt: typeof acceptPreviewBuildReceipt;
  transition: typeof transitionPreviewBuildJob;
}): Promise<"advanced" | "failed" | "unchanged"> {
  if (
    input.job.status !== "builder_succeeded" ||
    !input.job.builderTaskArn ||
    !input.config.receiptPublicKeyPem
  ) {
    return "unchanged";
  }
  if (
    input.now.getTime() - input.job.updatedAt.getTime() >
    ATTESTOR_TIMEOUT_MS
  ) {
    const failed = await input.transition({
      jobId: input.job.jobId,
      expectedStatus: "builder_succeeded",
      expectedVersion: input.job.stateVersion,
      nextStatus: "failed",
      failureCode: "PREVIEW_ATTESTOR_TIMEOUT",
      now: input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  const result = await input.attest({
    gatewayUrl: input.config.gatewayUrl!,
    privateKeyPem: input.config.privateKeyPem!,
    job: input.job,
    builderTaskArn: input.job.builderTaskArn,
    now: input.now,
  });
  if (result.state === "pending") return "unchanged";
  if (result.state === "failed") {
    const failed = await input.transition({
      jobId: input.job.jobId,
      expectedStatus: "builder_succeeded",
      expectedVersion: input.job.stateVersion,
      nextStatus: "failed",
      failureCode: "PREVIEW_ATTESTOR_FAILED",
      now: input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  try {
    await input.acceptReceipt({
      jobId: input.job.jobId,
      token: result.receiptToken,
      publicKeyPem: input.config.receiptPublicKeyPem,
      dependencies: { now: () => input.now },
    });
    return "advanced";
  } catch (error) {
    if (
      error instanceof PreviewBuildAttestationError &&
      (error.code === "PREVIEW_BUILD_ATTESTOR_RECEIPT_REJECTED" ||
        error.code === "PREVIEW_BUILD_ATTESTOR_CONFLICT")
    ) {
      const failed = await input.transition({
        jobId: input.job.jobId,
        expectedStatus: "builder_succeeded",
        expectedVersion: input.job.stateVersion,
        nextStatus: "failed",
        failureCode: "PREVIEW_ATTESTOR_RECEIPT_REJECTED",
        now: input.now,
      });
      return failed ? "failed" : "unchanged";
    }
    throw error;
  }
}

export async function reconcilePreviewBuildJobsOnce(
  input: {
    config?: ReconciliationConfig;
    dependencies?: ReconciliationDependencies;
  } = {},
): Promise<PreviewBuildReconciliationCounts> {
  const reconciliationConfig = input.config ?? {
    gatewayUrl: config.previewGatewayUrl,
    privateKeyPem: config.previewBuildJobPrivateKeyPem,
    receiptPublicKeyPem: config.previewBuildReceiptPublicKeyPem,
  };
  const now = input.dependencies?.now ?? (() => new Date());
  const listJobs =
    input.dependencies?.listJobs ?? findPreviewBuildJobsToReconcile;
  const observe = input.dependencies?.observe ?? observePreviewBuildJob;
  const attest = input.dependencies?.attest ?? attestPreviewBuildJob;
  const acceptReceipt =
    input.dependencies?.acceptReceipt ?? acceptPreviewBuildReceipt;
  const transition =
    input.dependencies?.transition ?? transitionPreviewBuildJob;
  const counts: PreviewBuildReconciliationCounts = {
    inspected: 0,
    advanced: 0,
    failed: 0,
    expired: 0,
    awaitingOutput: 0,
    unchanged: 0,
  };
  if (!reconciliationConfig.gatewayUrl || !reconciliationConfig.privateKeyPem) {
    return counts;
  }

  const jobs = await listJobs(MAX_JOBS_PER_PASS, reconciliationCursor);
  reconciliationCursor = jobs.at(-1)?.jobId;
  for (let offset = 0; offset < jobs.length; offset += RECONCILE_CONCURRENCY) {
    const batch = jobs.slice(offset, offset + RECONCILE_CONCURRENCY);
    counts.inspected += batch.length;
    const results = await Promise.all(
      batch.map(async (job) => {
        const observedAt = now();
        try {
          if (job.status === "queued") {
            if (job.tokenExpiresAt.getTime() > observedAt.getTime()) {
              return "unchanged" as const;
            }
            const expired = await transition({
              jobId: job.jobId,
              expectedStatus: "queued",
              expectedVersion: job.stateVersion,
              nextStatus: "expired",
              now: observedAt,
            });
            return expired ? ("expired" as const) : ("unchanged" as const);
          }
          if (job.status === "builder_succeeded") {
            return await reconcileAttestation({
              job,
              config: reconciliationConfig,
              now: observedAt,
              attest,
              acceptReceipt,
              transition,
            });
          }
          const observed = await observe({
            gatewayUrl: reconciliationConfig.gatewayUrl,
            privateKeyPem: reconciliationConfig.privateKeyPem,
            job,
            now: observedAt,
          });
          return await applyObservation({
            job,
            observation: observed,
            now: observedAt,
            transition,
          });
        } catch {
          return "unchanged" as const;
        }
      }),
    );
    for (const result of results) {
      counts[result] += 1;
    }
  }
  return counts;
}

export function startPreviewBuildReconciliationWorker(
  input: {
    intervalMs?: number;
    onPass?: (counts: PreviewBuildReconciliationCounts) => void;
    onError?: () => void;
  } = {},
): { stop: () => void } {
  if (!config.previewGatewayUrl || !config.previewBuildJobPrivateKeyPem) {
    return { stop: () => undefined };
  }
  const intervalMs = input.intervalMs ?? RECONCILE_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("Preview build reconciliation interval is invalid.");
  }
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const counts = await reconcilePreviewBuildJobsOnce();
      input.onPass?.(counts);
    } catch {
      input.onError?.();
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  void run();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
