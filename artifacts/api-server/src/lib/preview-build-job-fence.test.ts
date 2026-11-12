import { describe, expect, it } from "vitest";
import { createDynamoPreviewBuildJobFenceStorage } from "./preview-build-job-fence.js";

describe("Preview build job replay fence", () => {
  it("claims a job ID only once with an atomic conditional PutItem", async () => {
    const calls: Array<{ input: Record<string, unknown> }> = [];
    const fence = createDynamoPreviewBuildJobFenceStorage({
      tableName: "preview-builder-job-fence",
      commands: {
        put: (input) => ({ input }),
        get: (input) => ({ input }),
      },
      client: {
        async send(command) {
          calls.push(command as { input: Record<string, unknown> });
          return {};
        },
      },
    });
    await expect(
      fence.claimOrResume({
        jobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        nowEpoch: 1_700_000_000,
        expiresAtEpoch: 1_800_000_000,
      }),
    ).resolves.toBe(true);
    expect(calls[0]?.input).toMatchObject({
      TableName: "preview-builder-job-fence",
      Item: {
        job_id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        status: "claimed",
        expires_at_epoch: 1_800_000_000,
      },
      ConditionExpression: "attribute_not_exists(#job_id)",
      ExpressionAttributeNames: { "#job_id": "job_id" },
    });
  });

  it("rejects a conditional collision when the durable job cannot be read", async () => {
    const fence = createDynamoPreviewBuildJobFenceStorage({
      tableName: "preview-builder-job-fence",
      commands: {
        put: (input) => input,
        get: (input) => input,
      },
      client: {
        async send(command) {
          if ("ConditionExpression" in (command as object)) {
            throw Object.assign(new Error("already claimed"), {
              name: "ConditionalCheckFailedException",
            });
          }
          return {};
        },
      },
    });
    await expect(
      fence.claimOrResume({
        jobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        nowEpoch: 1_700_000_000,
        expiresAtEpoch: 1_800_000_000,
      }),
    ).resolves.toBe(false);
  });

  it("allows recovery only when a strong read confirms the exact job fingerprint", async () => {
    const calls: Array<{ kind: string; input: Record<string, unknown> }> = [];
    const fence = createDynamoPreviewBuildJobFenceStorage({
      tableName: "preview-builder-job-fence",
      commands: {
        put: (input) => ({ kind: "put", input }),
        get: (input) => ({ kind: "get", input }),
      },
      client: {
        async send(command) {
          const call = command as {
            kind: string;
            input: Record<string, unknown>;
          };
          calls.push(call);
          if (call.kind === "put") {
            throw Object.assign(new Error("already claimed"), {
              name: "ConditionalCheckFailedException",
            });
          }
          return {
            Item: {
              job_id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
              fingerprint: "a".repeat(64),
              status: "claimed",
              expires_at_epoch: 1_800_000_000,
            },
          };
        },
      },
    });

    await expect(
      fence.claimOrResume({
        jobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        nowEpoch: 1_700_000_000,
        expiresAtEpoch: 1_800_000_000,
      }),
    ).resolves.toBe(true);
    expect(calls.map(({ kind }) => kind)).toEqual(["put", "get"]);
    expect(calls[1]?.input).toMatchObject({
      TableName: "preview-builder-job-fence",
      Key: { job_id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa" },
      ConsistentRead: true,
    });
  });

  it("does not resume a different fingerprint or an expired job", async () => {
    for (const item of [
      {
        job_id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "b".repeat(64),
        status: "claimed",
        expires_at_epoch: 1_800_000_000,
      },
      {
        job_id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        status: "claimed",
        expires_at_epoch: 1_600_000_000,
      },
    ]) {
      const fence = createDynamoPreviewBuildJobFenceStorage({
        tableName: "preview-builder-job-fence",
        commands: {
          put: (input) => ({ kind: "put", input }),
          get: (input) => ({ kind: "get", input }),
        },
        client: {
          async send(command) {
            if ((command as { kind?: string }).kind === "put") {
              throw Object.assign(new Error("already claimed"), {
                name: "ConditionalCheckFailedException",
              });
            }
            return { Item: item };
          },
        },
      });
      await expect(
        fence.claimOrResume({
          jobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
          fingerprint: "a".repeat(64),
          nowEpoch: 1_700_000_000,
          expiresAtEpoch: 1_800_000_000,
        }),
      ).resolves.toBe(false);
    }
  });

  it("does not hide an unavailable fence store as a replay", async () => {
    const fence = createDynamoPreviewBuildJobFenceStorage({
      tableName: "preview-builder-job-fence",
      commands: {
        put: (input) => input,
        get: (input) => input,
      },
      client: {
        async send() {
          throw new Error("DynamoDB unavailable");
        },
      },
    });
    await expect(
      fence.claimOrResume({
        jobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
        fingerprint: "a".repeat(64),
        nowEpoch: 1_700_000_000,
        expiresAtEpoch: 1_800_000_000,
      }),
    ).rejects.toThrow("DynamoDB unavailable");
  });
});
