import type { PreviewBuildJobClaims } from "./preview-build-job.js";

export type PreviewBuildJobFence = {
  claimOrResume(input: {
    jobId: string;
    fingerprint: string;
    nowEpoch: number;
    expiresAtEpoch: number;
  }): Promise<boolean>;
};

type DynamoDocumentClientPort = {
  send(command: unknown): Promise<unknown>;
};

type DynamoPutCommandFactory = {
  put(input: Record<string, unknown>): unknown;
};

type DynamoGetCommandFactory = {
  get(input: Record<string, unknown>): unknown;
};

function isConditionalWriteConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ConditionalCheckFailedException"
  );
}

export function createDynamoPreviewBuildJobFenceStorage(input: {
  client: DynamoDocumentClientPort;
  commands: DynamoPutCommandFactory & DynamoGetCommandFactory;
  tableName: string;
}): PreviewBuildJobFence {
  if (!input.tableName || input.tableName.trim() !== input.tableName) {
    throw new Error("Preview build job fence table is not configured.");
  }

  return {
    async claimOrResume({ jobId, fingerprint, nowEpoch, expiresAtEpoch }) {
      try {
        await input.client.send(
          input.commands.put({
            TableName: input.tableName,
            Item: {
              job_id: jobId,
              fingerprint,
              status: "claimed",
              expires_at_epoch: expiresAtEpoch,
            },
            ConditionExpression: "attribute_not_exists(#job_id)",
            ExpressionAttributeNames: {
              "#job_id": "job_id",
            },
          }),
        );
        return true;
      } catch (error) {
        if (!isConditionalWriteConflict(error)) throw error;
      }

      const existing = (await input.client.send(
        input.commands.get({
          TableName: input.tableName,
          Key: { job_id: jobId },
          ConsistentRead: true,
        }),
      )) as {
        Item?: {
          fingerprint?: unknown;
          status?: unknown;
          expires_at_epoch?: unknown;
        };
      };
      return (
        existing.Item?.fingerprint === fingerprint &&
        existing.Item.status === "claimed" &&
        existing.Item.expires_at_epoch === expiresAtEpoch &&
        Number.isSafeInteger(nowEpoch) &&
        expiresAtEpoch > nowEpoch
      );
    },
  };
}

export function previewBuildJobFenceExpiry(
  claims: Pick<PreviewBuildJobClaims, "expiresAt">,
): number {
  return Math.floor(Date.parse(claims.expiresAt) / 1_000) + 86_400;
}
