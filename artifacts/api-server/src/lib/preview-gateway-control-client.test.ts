import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dispatchPreviewControlCommand } from "./preview-gateway-control-client.js";
import type { PreviewControlCommand } from "./preview-control-command.js";

const now = new Date("2026-11-11T00:00:00.000Z");
const sessionId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";
const taskDefinitionArn =
  "arn:aws:ecs:eu-central-1:123456789012:task-definition/engineeringos-preview-vite:4";
const taskArn =
  "arn:aws:ecs:eu-central-1:123456789012:task/engineeringos-preview/abcdef0123456789abcdef0123456789";
const { privateKey } = generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;

const command = {
  version: 1,
  action: "start",
  commandId: "88a2ac82-09ee-4f51-b53a-bbf120c4f9e4",
  sessionId,
  stateVersion: 0,
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 15_000).toISOString(),
  proposalId: "proposal-test",
  proposalRevision: 7,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  outputArtifactKey:
    "preview-build-outputs/9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa/site.tar.gz",
  outputArtifactDigest: "d".repeat(64),
  imageDigest: `sha256:${"c".repeat(64)}`,
  taskDefinitionArn,
  sessionExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
} satisfies Extract<PreviewControlCommand, { action: "start" }>;

describe("Preview Gateway control client", () => {
  it("sends only a signed POST to the fixed HTTPS control route", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const result = await dispatchPreviewControlCommand({
      command,
      privateKeyPem,
      gatewayUrl: "https://preview.example.com/",
      now,
      fetcher: async (input, init) => {
        capturedUrl = new URL(input.toString());
        capturedInit = init;
        return Response.json({
          action: "start",
          taskArn,
          taskDefinitionArn,
        });
      },
    });

    expect(result).toEqual({ action: "start", taskArn, taskDefinitionArn });
    expect(capturedUrl?.href).toBe(
      "https://preview.example.com/internal/v1/preview/commands",
    );
    expect(capturedInit).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(capturedInit?.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
    });
    const body = JSON.parse(String(capturedInit?.body)) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects private, IP-literal, redirected, and malformed Gateway targets", async () => {
    const privateTargets = [
      "http://preview.example.com",
      "https://localhost",
      "https://10.0.0.4",
      "https://gateway.internal",
      "https://preview.example.com/other",
    ];
    for (const gatewayUrl of privateTargets) {
      await expect(
        dispatchPreviewControlCommand({
          command,
          privateKeyPem,
          gatewayUrl,
          now,
          fetcher: async () => Response.json({}),
        }),
      ).rejects.toMatchObject({ code: "PREVIEW_GATEWAY_URL_INVALID" });
    }

    await expect(
      dispatchPreviewControlCommand({
        command,
        privateKeyPem,
        gatewayUrl: "https://preview.example.com",
        now,
        fetcher: async () => {
          throw new TypeError("redirect rejected");
        },
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_GATEWAY_UNAVAILABLE" });
  });

  it("rejects missing signing configuration and unexpected task responses", async () => {
    await expect(
      dispatchPreviewControlCommand({
        command,
        privateKeyPem: undefined,
        gatewayUrl: "https://preview.example.com",
        now,
        fetcher: async () => Response.json({}),
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_GATEWAY_KEY_MISSING" });

    await expect(
      dispatchPreviewControlCommand({
        command,
        privateKeyPem,
        gatewayUrl: "https://preview.example.com",
        now,
        fetcher: async () =>
          Response.json({
            action: "start",
            taskArn: "arn:aws:ecs:eu-central-1:123456789012:task/other",
            taskDefinitionArn,
          }),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_GATEWAY_RESPONSE_INVALID",
    });
  });
});
