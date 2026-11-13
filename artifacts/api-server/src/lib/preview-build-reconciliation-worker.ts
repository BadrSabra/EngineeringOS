import { randomUUID } from "node:crypto";
import type { PreviewBuildJob } from "@workspace/db";
import { config } from "../config.js";
import {
  claimPreviewBuildJobsForReconciliation,
  findPreviewBuildJobsToReconcile,
  releasePreviewBuildJobReconciliationLease,
  renewPreviewBuildJobReconciliationLease,
  transitionPreviewBuildJob,
} from "./preview-build-job-store.js";
import { createPreviewBuildGatewayExecutor } from "./preview-build-executor-gateway.js";
import {
  type PreviewBuildObservation,
  type PreviewBuildExecutor,
} from "./preview-build-provider-contracts.js";
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
const RECONCILIATION_LEASE_MS = 60_000;
const RECONCILIATION_HEARTBEAT_MS = 15_000;
let reconciliationCursor: string | undefined;

type ReconciliationConfig = {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
  receiptPublicKeyPem?: string;
};

type ReconciliationDependencies = {
  now?: () => Date;
  claimJobs?: typeof claimPreviewBuildJobsForReconciliation;
  listJobs?: typeof findPreviewBuildJobsToReconcile;
  executor?: PreviewBuildExecutor;
  attest?: typeof attestPreviewBuildJob;
  acceptReceipt?: typeof acceptPreviewBuildReceipt;
  renewLease?: typeof renewPreviewBuildJobReconciliationLease;
  releaseLease?: typeof releasePreviewBuildJobReconciliationLease;
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
  leaseOwner?: string;
  observation: PreviewBuildObservation;
  now: Date;
  currentTime?: () => Date;
  transition: typeof transitionPreviewBuildJob;
}): Promise<"advanced" | "failed" | "awaitingOutput" | "unchanged"> {
  let job = input.job;
  let advanced = false;
  const observation = input.observation;
  if (
    job.executionRef &&
    observation.executionRef &&
    job.executionRef !== observation.executionRef
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
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "failed",
      failureCode: "BUILDER_TASK_NOT_FOUND",
      now: input.currentTime?.() ?? input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  if (
    job.status === "launching" &&
    observation.executionRef &&
    ["pending", "running", "stopped"].includes(observation.state)
  ) {
    const running = await input.transition({
      jobId: job.jobId,
      expectedStatus: "launching",
      expectedVersion: job.stateVersion,
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "running",
      executionRef: observation.executionRef,
      now: input.currentTime?.() ?? input.now,
    });
    if (!running) return "unchanged";
    job = running;
    advanced = true;
  }

  if (job.status !== "running" || observation.state !== "stopped") {
    return advanced ? "advanced" : "unchanged";
  }
  if (!job.executionRef || job.executionRef !== observation.executionRef) {
    return "unchanged";
  }
  if (observation.exitCode === undefined || observation.exitCode !== 0) {
    const failed = await input.transition({
      jobId: job.jobId,
      expectedStatus: "running",
      expectedVersion: job.stateVersion,
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "failed",
      failureCode:
        observation.exitCode === undefined
          ? "BUILDER_EXIT_UNAVAILABLE"
          : "BUILDER_EXIT_NONZERO",
      now: input.currentTime?.() ?? input.now,
    });
    return failed ? "failed" : "unchanged";
  }
  if (observation.exitCode === 0 && observation.outputDigest) {
    const succeeded = await input.transition({
      jobId: job.jobId,
      expectedStatus: "running",
      expectedVersion: job.stateVersion,
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "builder_succeeded",
      executionRef: job.executionRef,
      outputDigest: observation.outputDigest,
      now: input.currentTime?.() ?? input.now,
    });
    return succeeded ? "advanced" : "unchanged";
  }
  return observation.exitCode === 0 ? "awaitingOutput" : "unchanged";
}

async function reconcileAttestation(input: {
  job: PreviewBuildJob;
  leaseOwner?: string;
  config: ReconciliationConfig;
  now: Date;
  currentTime?: () => Date;
  attest: typeof attestPreviewBuildJob;
  acceptReceipt: typeof acceptPreviewBuildReceipt;
  transition: typeof transitionPreviewBuildJob;
}): Promise<"advanced" | "failed" | "unchanged"> {
  if (
    input.job.status !== "builder_succeeded" ||
    !input.job.executionRef ||
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
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "failed",
      failureCode: "PREVIEW_ATTESTOR_TIMEOUT",
      now: input.currentTime?.() ?? input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  const result = await input.attest({
    gatewayUrl: input.config.gatewayUrl!,
    privateKeyPem: input.config.privateKeyPem!,
    job: input.job,
    executionRef: input.job.executionRef,
    now: input.now,
  });
  if (result.state === "pending") return "unchanged";
  if (result.state === "failed") {
    const failed = await input.transition({
      jobId: input.job.jobId,
      expectedStatus: "builder_succeeded",
      expectedVersion: input.job.stateVersion,
      expectedLeaseOwner: input.leaseOwner,
      nextStatus: "failed",
      failureCode: "PREVIEW_ATTESTOR_FAILED",
      now: input.currentTime?.() ?? input.now,
    });
    return failed ? "failed" : "unchanged";
  }

  try {
    await input.acceptReceipt({
      jobId: input.job.jobId,
      token: result.receiptToken,
      publicKeyPem: input.config.receiptPublicKeyPem,
      expectedLeaseOwner: input.leaseOwner,
      dependencies: { now: input.currentTime ?? (() => input.now) },
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
        expectedLeaseOwner: input.leaseOwner,
        nextStatus: "failed",
        failureCode: "PREVIEW_ATTESTOR_RECEIPT_REJECTED",
        now: input.currentTime?.() ?? input.now,
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
  const claimJobs =
    input.dependencies?.claimJobs ??
    (input.dependencies?.listJobs
      ? null
      : claimPreviewBuildJobsForReconciliation);
  const listJobs =
    input.dependencies?.listJobs ?? findPreviewBuildJobsToReconcile;
  const executor =
    input.dependencies?.executor ??
    createPreviewBuildGatewayExecutor({
      gatewayUrl: reconciliationConfig.gatewayUrl,
      privateKeyPem: reconciliationConfig.privateKeyPem,
    });
  const attest = input.dependencies?.attest ?? attestPreviewBuildJob;
  const acceptReceipt =
    input.dependencies?.acceptReceipt ?? acceptPreviewBuildReceipt;
  const transition =
    input.dependencies?.transition ?? transitionPreviewBuildJob;
  const renewLease =
    input.dependencies?.renewLease ??
    renewPreviewBuildJobReconciliationLease;
  const releaseLease =
    input.dependencies?.releaseLease ??
    releasePreviewBuildJobReconciliationLease;
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

  const leaseOwner = randomUUID();
  const jobs = claimJobs
    ? await claimJobs({
        limit: MAX_JOBS_PER_PASS,
        afterJobId: reconciliationCursor,
        leaseOwner,
        now: now(),
        leaseMs: RECONCILIATION_LEASE_MS,
      })
    : await listJobs(MAX_JOBS_PER_PASS, reconciliationCursor);
  reconciliationCursor = jobs.at(-1)?.jobId;
  for (let offset = 0; offset < jobs.length; offset += RECONCILE_CONCURRENCY) {
    const batch = jobs.slice(offset, offset + RECONCILE_CONCURRENCY);
    counts.inspected += batch.length;
    const results = await Promise.all(
      batch.map(async (job) => {
        const jobLeaseOwner = job.reconciliationLeaseOwner ?? undefined;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let renewalInFlight: Promise<void> | undefined;
        try {
          if (jobLeaseOwner) {
            heartbeat = setInterval(() => {
              if (renewalInFlight) return;
              renewalInFlight = renewLease({
                jobId: job.jobId,
                leaseOwner: jobLeaseOwner,
                now: now(),
                leaseMs: RECONCILIATION_LEASE_MS,
              })
                .then((renewed) => {
                  if (!renewed) {
                    throw new Error("Preview reconciliation lease was lost.");
                  }
                })
                .catch(() => undefined)
                .then(() => {
                  renewalInFlight = undefined;
                });
            }, RECONCILIATION_HEARTBEAT_MS);
            heartbeat.unref?.();
          }
          const observedAt = now();
          const result = await (async () => {
          if (job.status === "queued") {
            if (job.tokenExpiresAt.getTime() > observedAt.getTime()) {
              return "unchanged" as const;
            }
            const expired = await transition({
              jobId: job.jobId,
              expectedStatus: "queued",
              expectedVersion: job.stateVersion,
              expectedLeaseOwner: jobLeaseOwner,
              nextStatus: "expired",
              now: observedAt,
            });
            return expired ? ("expired" as const) : ("unchanged" as const);
          }
          if (job.status === "builder_succeeded") {
            return await reconcileAttestation({
              job,
              config: reconciliationConfig,
              leaseOwner: jobLeaseOwner,
              now: observedAt,
              currentTime: now,
              attest,
              acceptReceipt,
              transition,
            });
          }
          const observed = await executor.observe({
            job,
            now: observedAt,
          });
          return await applyObservation({
            job,
            leaseOwner: jobLeaseOwner,
            observation: observed,
            now: observedAt,
            currentTime: now,
            transition,
          });
          })();
          return result;
        } catch {
          return "unchanged" as const;
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          if (renewalInFlight) await renewalInFlight;
          if (jobLeaseOwner) {
            await releaseLease({
              jobId: job.jobId,
              leaseOwner: jobLeaseOwner,
            }).catch(() => undefined);
          }
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
