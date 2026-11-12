import { describe, expect, it } from "vitest";
import {
  previewControlCommandFingerprint,
  type PreviewControlCommand,
} from "./preview-control-command.js";
import {
  createDynamoPreviewCommandFenceStorage,
  createPreviewCommandFence,
  type PreviewCommandFenceStorage,
  type PreviewCommandFenceRecord,
} from "./preview-command-fence.js";

const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const sessionExpiresAt = "2026-11-11T00:30:00.000Z";
const start: PreviewControlCommand = {
  version: 1,
  action: "start",
  commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
  sessionId,
  stateVersion: 0,
  issuedAt: "2026-11-11T00:00:00.000Z",
  expiresAt: "2026-11-11T00:00:15.000Z",
  proposalId: "proposal-test",
  proposalRevision: 7,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  outputArtifactKey:
    "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
  outputArtifactDigest: "d".repeat(64),
  imageDigest: `sha256:${"c".repeat(64)}`,
  taskDefinitionArn,
  sessionExpiresAt,
};
const stop: PreviewControlCommand = {
  version: 1,
  action: "stop",
  commandId: "a9328405-57f6-44ce-8f4a-880647cd00dd",
  sessionId,
  stateVersion: 1,
  issuedAt: "2026-11-11T00:01:00.000Z",
  expiresAt: "2026-11-11T00:01:15.000Z",
  taskDefinitionArn,
  sessionExpiresAt,
};

class MemoryFenceStorage implements PreviewCommandFenceStorage {
  readonly items = new Map<string, PreviewCommandFenceRecord>();

  async advance(record: PreviewCommandFenceRecord) {
    const current = this.items.get(record.sessionId);
    if (current && current.stateVersion >= record.stateVersion) {
      return "conflict" as const;
    }
    this.items.set(record.sessionId, record);
    return "advanced" as const;
  }

  async read(sessionIdValue: string) {
    return this.items.get(sessionIdValue) ?? null;
  }
}

function commandTtl(command: PreviewControlCommand) {
  return Math.floor(Date.parse(command.sessionExpiresAt) / 1_000 + 86_400);
}

describe("Preview command replay fence", () => {
  it("allows semantic retries but rejects a command that changes the same version", async () => {
    const fence = createPreviewCommandFence(new MemoryFenceStorage());
    const fingerprint = previewControlCommandFingerprint(start);

    await expect(
      fence.claim({
        command: start,
        fingerprint,
        expiresAtEpoch: commandTtl(start),
      }),
    ).resolves.toBe(true);

    const retry = {
      ...start,
      commandId: "ef3702c9-2722-4d26-98ed-52b0caefb4a5",
      issuedAt: "2026-11-11T00:00:05.000Z",
      expiresAt: "2026-11-11T00:00:20.000Z",
    };
    await expect(
      fence.claim({
        command: retry,
        fingerprint: previewControlCommandFingerprint(retry),
        expiresAtEpoch: commandTtl(retry),
      }),
    ).resolves.toBe(true);

    const changed = { ...retry, imageDigest: `sha256:${"d".repeat(64)}` };
    await expect(
      fence.claim({
        command: changed,
        fingerprint: previewControlCommandFingerprint(changed),
        expiresAtEpoch: commandTtl(changed),
      }),
    ).resolves.toBe(false);

    const changedArtifact = {
      ...retry,
      outputArtifactDigest: "e".repeat(64),
    };
    await expect(
      fence.claim({
        command: changedArtifact,
        fingerprint: previewControlCommandFingerprint(changedArtifact),
        expiresAtEpoch: commandTtl(changedArtifact),
      }),
    ).resolves.toBe(false);
  });

  it("advances the durable version on Stop and fences every older Start", async () => {
    const fence = createPreviewCommandFence(new MemoryFenceStorage());
    await fence.claim({
      command: start,
      fingerprint: previewControlCommandFingerprint(start),
      expiresAtEpoch: commandTtl(start),
    });
    await expect(
      fence.claim({
        command: stop,
        fingerprint: previewControlCommandFingerprint(stop),
        expiresAtEpoch: commandTtl(stop),
      }),
    ).resolves.toBe(true);

    await expect(
      fence.claim({
        command: start,
        fingerprint: previewControlCommandFingerprint(start),
        expiresAtEpoch: commandTtl(start),
      }),
    ).resolves.toBe(false);
    await expect(fence.isCurrent({ sessionId, stateVersion: 0 })).resolves.toBe(
      false,
    );
  });

  it("uses an atomic DynamoDB condition and consistent reads", async () => {
    const commands: Array<{ kind: string; input: Record<string, unknown> }> =
      [];
    const storage = createDynamoPreviewCommandFenceStorage({
      tableName: "preview-command-fence",
      commands: {
        update: (input) => ({ kind: "update", input }),
        get: (input) => ({ kind: "get", input }),
      },
      client: {
        async send(command) {
          const entry = command as {
            kind: string;
            input: Record<string, unknown>;
          };
          commands.push(entry);
          if (entry.kind === "get") {
            return {
              Item: {
                session_id: sessionId,
                state_version: 1,
                action: "stop",
                fingerprint: "stop-fingerprint",
                expires_at_epoch: 1_800_000_000,
              },
            };
          }
          return {};
        },
      },
    });

    await storage.advance({
      sessionId,
      stateVersion: 1,
      action: "stop",
      fingerprint: "stop-fingerprint",
      expiresAtEpoch: 1_800_000_000,
    });
    expect(commands[0]?.input).toMatchObject({
      TableName: "preview-command-fence",
      Key: { session_id: sessionId },
      ConditionExpression:
        "attribute_not_exists(#state_version) OR #state_version < :state_version OR (#state_version = :state_version AND #action = :action AND #fingerprint = :fingerprint)",
      ExpressionAttributeValues: {
        ":state_version": 1,
        ":action": "stop",
        ":fingerprint": "stop-fingerprint",
        ":expires_at_epoch": 1_800_000_000,
      },
    });

    await expect(storage.read(sessionId)).resolves.toEqual({
      sessionId,
      stateVersion: 1,
      action: "stop",
      fingerprint: "stop-fingerprint",
      expiresAtEpoch: 1_800_000_000,
    });
    expect(commands[1]?.input).toMatchObject({
      ConsistentRead: true,
      Key: { session_id: sessionId },
    });
  });

  it("treats only a conditional DynamoDB write failure as a version conflict", async () => {
    const storage = createDynamoPreviewCommandFenceStorage({
      tableName: "preview-command-fence",
      commands: {
        update: (input) => input,
        get: (input) => input,
      },
      client: {
        async send() {
          throw Object.assign(new Error("condition failed"), {
            name: "ConditionalCheckFailedException",
          });
        },
      },
    });

    await expect(
      storage.advance({
        sessionId,
        stateVersion: 0,
        action: "start",
        fingerprint: "start-fingerprint",
        expiresAtEpoch: 1_800_000_000,
      }),
    ).resolves.toBe("conflict");
  });
});
