import type { PreviewControlCommand } from "./preview-control-command.js";
import type { PreviewCommandFence } from "./preview-ecs-runner.js";

export type PreviewCommandFenceRecord = {
  sessionId: string;
  stateVersion: number;
  action: PreviewControlCommand["action"];
  fingerprint: string;
  expiresAtEpoch: number;
};

/**
 * The DynamoDB adapter must implement advance with a single conditional
 * UpdateItem: accept only when the item is absent or its state_version is
 * lower. A conflicting conditional update must not mutate the row.
 */
export type PreviewCommandFenceStorage = {
  advance(record: PreviewCommandFenceRecord): Promise<"advanced" | "conflict">;
  read(sessionId: string): Promise<PreviewCommandFenceRecord | null>;
};

type DynamoDocumentClientPort = {
  send(command: unknown): Promise<unknown>;
};

type DynamoFenceCommandFactory = {
  update(input: Record<string, unknown>): unknown;
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

export function createDynamoPreviewCommandFenceStorage(input: {
  client: DynamoDocumentClientPort;
  commands: DynamoFenceCommandFactory;
  tableName: string;
}): PreviewCommandFenceStorage {
  if (!input.tableName || input.tableName.trim() !== input.tableName) {
    throw new Error("Preview command fence table is not configured.");
  }

  return {
    async advance(record): Promise<"advanced" | "conflict"> {
      try {
        await input.client.send(
          input.commands.update({
            TableName: input.tableName,
            Key: { session_id: record.sessionId },
            UpdateExpression:
              "SET #state_version = :state_version, #action = :action, #fingerprint = :fingerprint, #expires_at_epoch = :expires_at_epoch",
            ConditionExpression:
              "attribute_not_exists(#state_version) OR #state_version < :state_version OR (#state_version = :state_version AND #action = :action AND #fingerprint = :fingerprint)",
            ExpressionAttributeNames: {
              "#state_version": "state_version",
              "#action": "action",
              "#fingerprint": "fingerprint",
              "#expires_at_epoch": "expires_at_epoch",
            },
            ExpressionAttributeValues: {
              ":state_version": record.stateVersion,
              ":action": record.action,
              ":fingerprint": record.fingerprint,
              ":expires_at_epoch": record.expiresAtEpoch,
            },
          }),
        );
        return "advanced";
      } catch (error) {
        if (isConditionalWriteConflict(error)) return "conflict";
        throw error;
      }
    },

    async read(sessionId): Promise<PreviewCommandFenceRecord | null> {
      const result = await input.client.send(
        input.commands.get({
          TableName: input.tableName,
          Key: { session_id: sessionId },
          ConsistentRead: true,
          ProjectionExpression:
            "session_id, state_version, #action, #fingerprint, #expires_at_epoch",
          ExpressionAttributeNames: {
            "#action": "action",
            "#fingerprint": "fingerprint",
            "#expires_at_epoch": "expires_at_epoch",
          },
        }),
      );
      if (
        !result ||
        typeof result !== "object" ||
        !("Item" in result) ||
        result.Item === undefined
      ) {
        return null;
      }
      const item = result.Item;
      if (
        !item ||
        typeof item !== "object" ||
        !("session_id" in item) ||
        item.session_id !== sessionId ||
        !("state_version" in item) ||
        !Number.isSafeInteger(item.state_version) ||
        !("action" in item) ||
        (item.action !== "start" && item.action !== "stop") ||
        !("fingerprint" in item) ||
        typeof item.fingerprint !== "string" ||
        !("expires_at_epoch" in item) ||
        !Number.isSafeInteger(item.expires_at_epoch)
      ) {
        throw new Error("Preview command fence record is malformed.");
      }
      return {
        sessionId,
        stateVersion: item.state_version as number,
        action: item.action,
        fingerprint: item.fingerprint,
        expiresAtEpoch: item.expires_at_epoch as number,
      };
    },
  };
}

export function createPreviewCommandFence(
  storage: PreviewCommandFenceStorage,
): PreviewCommandFence {
  return {
    async claim({ command, fingerprint, expiresAtEpoch }): Promise<boolean> {
      const record: PreviewCommandFenceRecord = {
        sessionId: command.sessionId,
        stateVersion: command.stateVersion,
        action: command.action,
        fingerprint,
        expiresAtEpoch,
      };
      const result = await storage.advance(record);
      if (result === "advanced") return true;

      const current = await storage.read(command.sessionId);
      return (
        current?.stateVersion === command.stateVersion &&
        current.fingerprint === fingerprint &&
        current.action === command.action
      );
    },

    async isCurrent({ sessionId, stateVersion }): Promise<boolean> {
      const current = await storage.read(sessionId);
      return (
        current?.stateVersion === stateVersion && current.action === "start"
      );
    },
  };
}
