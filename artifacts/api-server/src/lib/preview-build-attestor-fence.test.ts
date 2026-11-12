import { describe, expect, it } from "vitest";
import { createDynamoPreviewBuildAttestorFence } from "./preview-build-attestor-fence.js";

const jobId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const fingerprint = "a".repeat(64);
const nowEpoch = 1_700_000_000;

describe("Preview Attestor launch fence", () => {
  it("claims a new job with an atomic conditional write", async () => {
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const fence = createDynamoPreviewBuildAttestorFence({
      tableName: "preview-attestor-fence",
      client: {
        async send(command) {
          calls.push(command as { input: Record<string, unknown> });
          return {};
        },
      },
    });
    await expect(
      fence.claimOrResume({
        jobId,
        fingerprint,
        nowEpoch,
        expiresAtEpoch: nowEpoch + 86_400,
      }),
    ).resolves.toBe(true);
    expect(calls[0]?.input).toMatchObject({
      TableName: "preview-attestor-fence",
      Item: {
        job_id: jobId,
        fingerprint,
        status: "claimed",
        expires_at_epoch: nowEpoch + 86_400,
      },
      ConditionExpression: "attribute_not_exists(#job_id)",
    });
  });

  it("resumes an exact live fingerprint even when retry expiry differs", async () => {
    const calls: Array<{ kind?: string; input: Record<string, unknown> }> = [];
    const fence = createDynamoPreviewBuildAttestorFence({
      tableName: "preview-attestor-fence",
      client: {
        async send(command) {
          const call = command as {
            kind?: string;
            input: Record<string, unknown>;
          };
          calls.push(call);
          if (call.input.ConditionExpression) {
            throw Object.assign(new Error("claimed"), {
              name: "ConditionalCheckFailedException",
            });
          }
          return {
            Item: {
              job_id: jobId,
              fingerprint,
              status: "claimed",
              expires_at_epoch: nowEpoch + 86_400,
            },
          };
        },
      },
    });
    await expect(
      fence.claimOrResume({
        jobId,
        fingerprint,
        nowEpoch,
        expiresAtEpoch: nowEpoch + 172_800,
      }),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("refuses changed, expired, or terminal records", async () => {
    for (const Item of [
      {
        job_id: jobId,
        fingerprint: "b".repeat(64),
        status: "claimed",
        expires_at_epoch: nowEpoch + 86_400,
      },
      {
        job_id: jobId,
        fingerprint,
        status: "claimed",
        expires_at_epoch: nowEpoch,
      },
      {
        job_id: jobId,
        fingerprint,
        status: "failed",
        expires_at_epoch: nowEpoch + 86_400,
      },
    ]) {
      const fence = createDynamoPreviewBuildAttestorFence({
        tableName: "preview-attestor-fence",
        client: {
          async send(command) {
            const condition = (
              command as { input?: { ConditionExpression?: string } }
            ).input?.ConditionExpression;
            if (condition) {
              throw Object.assign(new Error("claimed"), {
                name: "ConditionalCheckFailedException",
              });
            }
            return { Item };
          },
        },
      });
      await expect(
        fence.claimOrResume({
          jobId,
          fingerprint,
          nowEpoch,
          expiresAtEpoch: nowEpoch + 86_400,
        }),
      ).resolves.toBe(false);
    }
  });
});
