import type { GetCommandInput, PutCommandInput } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export type PreviewBuildAttestorFence = {
  claimOrResume(input: {
    jobId: string;
    fingerprint: string;
    nowEpoch: number;
    expiresAtEpoch: number;
  }): Promise<boolean>;
};

export function createDynamoPreviewBuildAttestorFence(input: {
  client: { send(command: unknown): Promise<unknown> };
  tableName: string;
}): PreviewBuildAttestorFence {
  if (!input.tableName || input.tableName.trim() !== input.tableName) {
    throw new Error("Preview Attestor fence table is not configured.");
  }
  return {
    async claimOrResume({ jobId, fingerprint, nowEpoch, expiresAtEpoch }) {
      if (
        !/^[0-9a-f-]{36}$/i.test(jobId) ||
        !/^[a-f0-9]{64}$/i.test(fingerprint) ||
        !Number.isSafeInteger(nowEpoch) ||
        !Number.isSafeInteger(expiresAtEpoch) ||
        expiresAtEpoch <= nowEpoch
      ) {
        return false;
      }
      try {
        await input.client.send(
          new PutCommand({
            TableName: input.tableName,
            Item: {
              job_id: jobId,
              fingerprint: fingerprint.toLowerCase(),
              status: "claimed",
              expires_at_epoch: expiresAtEpoch,
            },
            ConditionExpression: "attribute_not_exists(#job_id)",
            ExpressionAttributeNames: { "#job_id": "job_id" },
          } satisfies PutCommandInput),
        );
        return true;
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("name" in error) ||
          error.name !== "ConditionalCheckFailedException"
        ) {
          throw error;
        }
      }

      const existing = (await input.client.send(
        new GetCommand({
          TableName: input.tableName,
          Key: { job_id: jobId },
          ConsistentRead: true,
        } satisfies GetCommandInput),
      )) as {
        Item?: {
          fingerprint?: unknown;
          status?: unknown;
          expires_at_epoch?: unknown;
        };
      };
      return (
        existing.Item?.fingerprint === fingerprint.toLowerCase() &&
        existing.Item.status === "claimed" &&
        Number.isSafeInteger(existing.Item.expires_at_epoch) &&
        (existing.Item.expires_at_epoch as number) > nowEpoch
      );
    },
  };
}
