import { describe, expect, it } from "vitest";
import type { PreviewSession } from "@workspace/db";
import { createPreviewSessionOrchestrator } from "./preview-session-orchestrator.js";
import type { PreviewControlCommand } from "./preview-control-command.js";
import type { PreviewEcsCommandResult } from "./preview-ecs-runner.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const session = {
  id: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
  proposalId: "proposal-test",
  userId: "user-test",
  proposalRevision: 7,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  buildOutputArtifactKey:
    "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
  buildOutputDigest: "d".repeat(64),
  imageDigest: `sha256:${"c".repeat(64)}`,
  buildJobId: "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa",
  buildReceiptId: "123e4567-e89b-42d3-a456-426614174000",
  taskDefinitionArn:
    "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4",
  status: "starting",
  runnerTaskArn: null,
  stateVersion: 0,
  expiresAt: new Date(now.getTime() + 10 * 60_000),
  readyAt: null,
  closedAt: null,
  createdAt: now,
  updatedAt: now,
} satisfies PreviewSession;
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";

describe("Preview session ECS orchestration", () => {
  it("dispatches the exact durable Candidate binding and attaches the returned task", async () => {
    const commands: PreviewControlCommand[] = [];
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      privateKeyPem: "private-key-not-read-by-test",
      gatewayUrl: "https://preview.example.com",
      dispatch: async ({ command }) => {
        commands.push(command);
        return {
          action: "start",
          taskArn,
          taskDefinitionArn: session.taskDefinitionArn,
        };
      },
      attachTask: async (input) => {
        expect(input).toEqual({
          sessionId: session.id,
          expectedVersion: 0,
          runnerTaskArn: taskArn,
          now,
        });
        return {
          ...session,
          runnerTaskArn: taskArn,
          stateVersion: 1,
        };
      },
    });

    const result = await orchestrator.start(session);
    expect(result?.runnerTaskArn).toBe(taskArn);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action: "start",
      sessionId: session.id,
      proposalId: session.proposalId,
      proposalRevision: session.proposalRevision,
      candidateRevision: session.candidateRevision,
      changeSetHash: session.changeSetHash,
      outputArtifactKey: session.buildOutputArtifactKey,
      outputArtifactDigest: session.buildOutputDigest,
      imageDigest: session.imageDigest,
      taskDefinitionArn: session.taskDefinitionArn,
      sessionExpiresAt: session.expiresAt.toISOString(),
    });
  });

  it("reuses the same start command identity after a lost response", async () => {
    const commandIds: string[] = [];
    let dispatchCount = 0;
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      dispatch: async ({ command }) => {
        commandIds.push(command.commandId);
        dispatchCount += 1;
        if (dispatchCount === 1) {
          throw new Error("gateway accepted launch but response was lost");
        }
        return {
          action: "start",
          taskArn,
          taskDefinitionArn: session.taskDefinitionArn,
        };
      },
      attachTask: async () => ({
        ...session,
        runnerTaskArn: taskArn,
        stateVersion: 1,
      }),
    });

    await expect(orchestrator.start(session)).rejects.toThrow(
      "gateway accepted launch but response was lost",
    );
    await expect(orchestrator.start(session)).resolves.toMatchObject({
      runnerTaskArn: taskArn,
      stateVersion: 1,
    });

    expect(commandIds).toHaveLength(2);
    expect(commandIds[1]).toBe(commandIds[0]);
  });

  it("stops the exact task if the fenced database attach loses its race", async () => {
    const commands: PreviewControlCommand[] = [];
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      dispatch: async ({ command }) => {
        commands.push(command);
        return command.action === "start"
          ? {
              action: "start",
              taskArn,
              taskDefinitionArn: session.taskDefinitionArn,
            }
          : { action: "stop", taskArn, stopped: true };
      },
      attachTask: async () => null,
    });

    await expect(orchestrator.start(session)).rejects.toMatchObject({
      code: "PREVIEW_SESSION_START_UNCONFIRMED",
    });
    expect(commands.map(({ action }) => action)).toEqual(["start", "stop"]);
    expect(commands[1]?.commandId).not.toBe(commands[0]?.commandId);
    expect(commands[1]).toMatchObject({
      action: "stop",
      sessionId: session.id,
      taskArn,
      taskDefinitionArn: session.taskDefinitionArn,
    });
  });

  it("keeps an uncertain launch recoverable and does not invent a task ARN", async () => {
    let attached = false;
    const attachTask = async () => {
      attached = true;
      throw new Error("database unavailable");
    };
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      dispatch: async () => {
        throw new Error("gateway response was lost");
      },
      attachTask,
    });

    await expect(orchestrator.start(session)).rejects.toThrow(
      "gateway response was lost",
    );
    expect(attached).toBe(false);
  });

  it("refuses stale session rows before sending a command", async () => {
    let dispatched = false;
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      dispatch: async () => {
        dispatched = true;
        return {
          action: "start",
          taskArn,
          taskDefinitionArn: session.taskDefinitionArn,
        } satisfies PreviewEcsCommandResult;
      },
    });

    await expect(
      orchestrator.start({
        ...session,
        expiresAt: new Date(now.getTime() - 1),
      }),
    ).resolves.toBeNull();
    expect(dispatched).toBe(false);
  });

  it("refuses a session without a build-output identity before dispatch", async () => {
    let dispatched = false;
    const orchestrator = createPreviewSessionOrchestrator({
      now: () => now,
      dispatch: async () => {
        dispatched = true;
        return {
          action: "start",
          taskArn,
          taskDefinitionArn: session.taskDefinitionArn,
        };
      },
    });

    await expect(
      orchestrator.start({ ...session, buildOutputArtifactKey: null }),
    ).resolves.toBeNull();
    expect(dispatched).toBe(false);
  });
});
