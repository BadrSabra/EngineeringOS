import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { previewAgentPublicKeyFingerprint } from "@workspace/preview-agent-contract";
import type { PreviewAgentIdentity } from "./identity.js";
import {
  checkLinuxSecretService,
  LinuxSecretServiceStore,
  type SecretToolResult,
} from "./linux-secret-service.js";

const nodeId = "a462a6c3-e2fa-49bb-a228-3e5a61330115";
const storeId = "bb550bc3-1930-4285-a33c-460b52dc8ea7";

function identity(): PreviewAgentIdentity {
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    version: 1,
    state: "active",
    nodeId,
    storeId,
    keyVersion: 1,
    publicKeyPem: keys.publicKey,
    privateKeyPem: keys.privateKey,
    fingerprint: previewAgentPublicKeyFingerprint(keys.publicKey),
    sequence: 0,
  };
}

describe("Linux Secret Service identity store", () => {
  it("checks a temporary keyring round-trip and always clears its probe", async () => {
    const calls: Array<{ args: string[]; input: string }> = [];
    let stored = "";
    const run = async (args: string[], input: string): Promise<SecretToolResult> => {
      calls.push({ args, input });
      if (args[0] === "store") {
        stored = input;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "lookup") {
        return { code: 0, stdout: `${stored}\n`, stderr: "" };
      }
      stored = "";
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(checkLinuxSecretService(run, "linux")).resolves.toBeUndefined();

    expect(calls.map(({ args }) => args[0])).toEqual([
      "store",
      "lookup",
      "clear",
    ]);
    expect(calls[0]?.args.slice(2, 5)).toEqual([
      "application",
      "engineeringos-preview-agent",
      "node-id",
    ]);
    expect(calls[0]?.input).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calls[0]?.args.join(" ")).not.toContain(calls[0]?.input);
    expect(stored).toBe("");
  });

  it("clears the temporary probe and fails closed when round-trip verification fails", async () => {
    const calls: string[][] = [];
    const run = async (args: string[]): Promise<SecretToolResult> => {
      calls.push(args);
      if (args[0] === "store") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "lookup") {
        return { code: 0, stdout: "different-value\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(checkLinuxSecretService(run, "linux")).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
    });
    expect(calls.map((args) => args[0])).toEqual([
      "store",
      "lookup",
      "clear",
    ]);
  });

  it("rejects unsupported operating systems without invoking secret-tool", async () => {
    let called = false;
    await expect(
      checkLinuxSecretService(async () => {
        called = true;
        return { code: 0, stdout: "", stderr: "" };
      }, "darwin"),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
    });
    expect(called).toBe(false);
  });

  it("stores private identity only on stdin and binds the keyring item to node id", async () => {
    const value = {
      ...identity(),
      unexpectedSecret: "must-not-be-persisted",
    } as PreviewAgentIdentity;
    const calls: Array<{ args: string[]; input: string }> = [];
    let saved = "";
    const store = new LinuxSecretServiceStore(async (args, input) => {
      calls.push({ args, input });
      if (args[0] === "store") saved = input;
      return { code: 0, stdout: "", stderr: "" } satisfies SecretToolResult;
    });

    await store.set(value);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "store",
      "--label=EngineeringOS Preview Agent identity",
      "application",
      "engineeringos-preview-agent",
      "node-id",
      nodeId,
    ]);
    expect(calls[0]?.args.join(" ")).not.toContain(value.privateKeyPem);
    expect(JSON.parse(saved)).toMatchObject({
      nodeId,
      privateKeyPem: value.privateKeyPem,
    });
    expect(saved).not.toContain("unexpectedSecret");
    expect(saved).not.toContain("must-not-be-persisted");
  });

  it("loads validated identity records and deletes only the selected node entry", async () => {
    const value = identity();
    let saved = JSON.stringify(value);
    const calls: string[][] = [];
    const store = new LinuxSecretServiceStore(async (args) => {
      calls.push(args);
      if (args[0] === "lookup") {
        return {
          code: 0,
          stdout: `${saved}\n`,
          stderr: "",
        };
      }
      if (args[0] === "clear") {
        saved = "";
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(store.get(nodeId)).resolves.toMatchObject({
      nodeId,
      state: "active",
    });
    await store.delete(nodeId);
    expect(calls.map((args) => args[0])).toEqual(["lookup", "clear"]);
    expect(calls[1]).toEqual([
      "clear",
      "application",
      "engineeringos-preview-agent",
      "node-id",
      nodeId,
    ]);
  });

  it("fails closed on malformed or mismatched keyring data", async () => {
    const store = new LinuxSecretServiceStore(async () => ({
      code: 0,
      stdout: JSON.stringify({ version: 1, nodeId: storeId }),
      stderr: "",
    }));

    await expect(store.get(nodeId)).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SECRET_RECORD_INVALID",
    });
  });

  it("treats a missing keyring item as absent and does not log command errors", async () => {
    const store = new LinuxSecretServiceStore(async () => ({
      code: 1,
      stdout: "",
      stderr: "",
    }));

    await expect(store.get(nodeId)).resolves.toBeNull();
    await expect(
      new LinuxSecretServiceStore(async () => {
        throw new Error("private detail");
      }).get(nodeId),
    ).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
    });
  });

  it("does not confuse keyring diagnostics with a missing item", async () => {
    const store = new LinuxSecretServiceStore(async () => ({
      code: 1,
      stdout: "",
      stderr: "Secret Service is locked",
    }));

    await expect(store.get(nodeId)).rejects.toMatchObject({
      code: "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
    });
  });
});
