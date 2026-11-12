import {
  PreviewBuilderRunnerError,
  assertPreviewBuilderRunnerConfig,
  type PreviewBuilderRunnerConfig,
} from "./preview-builder-runner.js";
import {
  verifyPreviewBuildObservation,
  type PreviewBuildObservationClaims,
} from "./preview-build-observation-command.js";
import type { PreviewEcsClient, PreviewEcsTask } from "./preview-ecs-runner.js";
import type { PreviewBuildTransferProvider } from "./preview-build-transfer-s3.js";

const TASK_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/i;
const MAX_BODY_BYTES = 8_192;
const RECONCILE_PATH = "/internal/v1/preview/builds/reconcile";
const REQUEST_FIELDS = ["token"] as const;

export type PreviewBuilderObservation = {
  jobId: string;
  buildId: string;
  state: "not_found" | "pending" | "running" | "stopped" | "unknown";
  taskArn?: string;
  exitCode?: number;
  outputDigest?: string;
};

export class PreviewBuildReconcileError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_BUILD_RECONCILE_COMMAND_REJECTED"
      | "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH"
      | "PREVIEW_BUILD_RECONCILE_UNAVAILABLE",
  ) {
    super("Preview Builder reconciliation was rejected or unavailable.");
    this.name = "PreviewBuildReconcileError";
  }
}

function classifyTask(
  task: PreviewEcsTask,
): PreviewBuilderObservation["state"] {
  switch (task.lastStatus) {
    case "PROVISIONING":
    case "PENDING":
    case "ACTIVATING":
    case "DEACTIVATING":
    case "DEPROVISIONING":
      return "pending";
    case "RUNNING":
      return "running";
    case "STOPPED":
      return "stopped";
    default:
      return "unknown";
  }
}

function exactTask(
  task: PreviewEcsTask | null,
  claims: PreviewBuildObservationClaims,
  config: PreviewBuilderRunnerConfig,
): PreviewEcsTask {
  if (
    !task?.taskArn ||
    !TASK_ARN_PATTERN.test(task.taskArn) ||
    task.clusterArn !== config.clusterArn ||
    task.startedBy !== claims.jobId ||
    task.taskDefinitionArn !== config.taskDefinitionArn ||
    (claims.taskArn !== undefined && task.taskArn !== claims.taskArn)
  ) {
    throw new PreviewBuildReconcileError(
      "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH",
    );
  }
  return task;
}

async function findTask(input: {
  claims: PreviewBuildObservationClaims;
  ecs: PreviewEcsClient;
  config: PreviewBuilderRunnerConfig;
}): Promise<PreviewEcsTask | null> {
  if (input.claims.taskArn) {
    return input.ecs.describeTask({
      cluster: input.config.clusterArn,
      taskArn: input.claims.taskArn,
    });
  }

  const taskArns = new Set<string>();
  for (const desiredStatus of ["PENDING", "RUNNING", "STOPPED"] as const) {
    const results = await input.ecs.listTasks({
      cluster: input.config.clusterArn,
      startedBy: input.claims.jobId,
      desiredStatus,
    });
    for (const taskArn of results) {
      if (!TASK_ARN_PATTERN.test(taskArn)) {
        throw new PreviewBuildReconcileError(
          "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH",
        );
      }
      taskArns.add(taskArn);
      if (taskArns.size > 1) {
        throw new PreviewBuildReconcileError(
          "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH",
        );
      }
    }
  }
  const [taskArn] = taskArns;
  if (!taskArn) return null;
  return input.ecs.describeTask({
    cluster: input.config.clusterArn,
    taskArn,
  });
}

export async function observePreviewBuilderTask(input: {
  token: string;
  publicKeyPem: string;
  ecs: PreviewEcsClient;
  transferProvider?: PreviewBuildTransferProvider;
  config: PreviewBuilderRunnerConfig;
  now?: Date;
}): Promise<PreviewBuilderObservation> {
  let claims: PreviewBuildObservationClaims;
  try {
    assertPreviewBuilderRunnerConfig(input.config);
    claims = verifyPreviewBuildObservation({
      token: input.token,
      publicKeyPem: input.publicKeyPem,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof PreviewBuilderRunnerError) {
      throw new PreviewBuildReconcileError(
        "PREVIEW_BUILD_RECONCILE_UNAVAILABLE",
      );
    }
    throw new PreviewBuildReconcileError(
      "PREVIEW_BUILD_RECONCILE_COMMAND_REJECTED",
    );
  }
  if (
    claims.builderImageDigest !== input.config.imageDigest ||
    !claims.outputArtifactKey.startsWith(
      `preview-build-outputs/${claims.buildId}/`,
    )
  ) {
    throw new PreviewBuildReconcileError(
      "PREVIEW_BUILD_RECONCILE_COMMAND_REJECTED",
    );
  }

  let task: PreviewEcsTask | null;
  try {
    task = await findTask({
      claims,
      ecs: input.ecs,
      config: input.config,
    });
  } catch (error) {
    if (error instanceof PreviewBuildReconcileError) throw error;
    throw new PreviewBuildReconcileError("PREVIEW_BUILD_RECONCILE_UNAVAILABLE");
  }
  if (!task) {
    return {
      jobId: claims.jobId,
      buildId: claims.buildId,
      state: "not_found",
    };
  }

  const validated = exactTask(task, claims, input.config);
  const state = classifyTask(validated);
  if (state === "stopped") {
    const builderContainers =
      validated.containers?.filter(
        (container) => container.name === "builder",
      ) ?? [];
    const exitCode =
      builderContainers.length === 1 &&
      Number.isSafeInteger(builderContainers[0]?.exitCode)
        ? builderContainers[0]?.exitCode
        : undefined;
    return {
      jobId: claims.jobId,
      buildId: claims.buildId,
      state,
      taskArn: validated.taskArn,
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(exitCode === 0 && input.transferProvider?.inspectOutput
        ? await input.transferProvider
            .inspectOutput({
              buildId: claims.buildId,
              outputArtifactKey: claims.outputArtifactKey,
            })
            .then((output) =>
              output ? { outputDigest: output.outputDigest } : {},
            )
        : {}),
    };
  }
  return {
    jobId: claims.jobId,
    buildId: claims.buildId,
    state,
    taskArn: validated.taskArn,
  };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase();
  const contentLength = Number(request.headers.get("content-length"));
  if (
    contentType !== "application/json" ||
    (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) ||
    !request.body
  ) {
    throw new Error("Invalid Builder reconciliation request.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Builder reconciliation request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPreviewBuildReconcileHandler(input: {
  ecs: PreviewEcsClient;
  transferProvider?: PreviewBuildTransferProvider;
  config: PreviewBuilderRunnerConfig;
  now?: () => Date;
}) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== RECONCILE_PATH) {
      return jsonResponse(404, { error: "Not found." });
    }

    let parsed: unknown;
    try {
      parsed = await readBoundedJson(request);
    } catch {
      return jsonResponse(400, {
        error: "Invalid Builder reconciliation request.",
      });
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== REQUEST_FIELDS.length ||
      REQUEST_FIELDS.some((field) => !(field in parsed)) ||
      typeof (parsed as Record<string, unknown>).token !== "string" ||
      ((parsed as Record<string, unknown>).token as string).length >
        MAX_BODY_BYTES
    ) {
      return jsonResponse(400, {
        error: "Invalid Builder reconciliation request.",
      });
    }

    try {
      const result = await observePreviewBuilderTask({
        token: (parsed as { token: string }).token,
        publicKeyPem: input.config.publicKeyPem,
        ecs: input.ecs,
        transferProvider: input.transferProvider,
        config: input.config,
        now: input.now?.(),
      });
      return jsonResponse(200, {
        ...result,
      });
    } catch (error) {
      const status =
        error instanceof PreviewBuildReconcileError &&
        error.code === "PREVIEW_BUILD_RECONCILE_COMMAND_REJECTED"
          ? 403
          : error instanceof PreviewBuildReconcileError &&
              error.code === "PREVIEW_BUILD_RECONCILE_IDENTITY_MISMATCH"
            ? 409
            : 503;
      return jsonResponse(status, {
        error:
          status === 403
            ? "Builder reconciliation command rejected."
            : status === 409
              ? "Builder task identity rejected."
              : "Builder reconciliation unavailable.",
      });
    }
  };
}
