import { spawn } from "node:child_process";
import { homedir } from "node:os";
import {
  validatePreviewAgentIdentity,
  type PreviewAgentIdentity,
} from "./identity.js";

const SERVICE_ATTRIBUTE = "application";
const SERVICE_NAME = "engineeringos-preview-agent";
const NODE_ATTRIBUTE = "node-id";
const MAX_SECRET_BYTES = 32 * 1024;
const MAX_OUTPUT_BYTES = 40 * 1024;
const COMMAND_TIMEOUT_MS = 5_000;

export class PreviewAgentSecretStoreError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE"
      | "PREVIEW_AGENT_SECRET_RECORD_INVALID",
  ) {
    super("Preview Agent operating-system secret storage is unavailable.");
    this.name = "PreviewAgentSecretStoreError";
  }
}

export interface PreviewAgentSecretStore {
  get(nodeId: string): Promise<PreviewAgentIdentity | null>;
  set(identity: PreviewAgentIdentity): Promise<void>;
  delete(nodeId: string): Promise<void>;
}

export type SecretToolResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type SecretToolRunner = (
  args: string[],
  input: string,
) => Promise<SecretToolResult>;

function secretToolEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: homedir(),
    LANG: "C",
    LC_ALL: "C",
  };
  for (const key of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export const runSecretTool: SecretToolRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, {
      shell: false,
      env: secretToolEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, COMMAND_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < 2_000) stderr += chunk;
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        new PreviewAgentSecretStoreError(
          "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut || outputBytes > MAX_OUTPUT_BYTES || code === null) {
        reject(
          new PreviewAgentSecretStoreError(
            "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
          ),
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });

export class LinuxSecretServiceStore implements PreviewAgentSecretStore {
  constructor(
    private readonly run: SecretToolRunner = runSecretTool,
  ) {
    if (process.platform !== "linux") {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
  }

  async get(nodeId: string): Promise<PreviewAgentIdentity | null> {
    if (!isUuid(nodeId)) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_RECORD_INVALID",
      );
    }
    let result: SecretToolResult;
    try {
      result = await this.run(
        [
          "lookup",
          SERVICE_ATTRIBUTE,
          SERVICE_NAME,
          NODE_ATTRIBUTE,
          nodeId,
        ],
        "",
      );
    } catch {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
    if (
      result.code === 1 &&
      result.stdout.length === 0 &&
      result.stderr.trim().length === 0
    ) {
      return null;
    }
    if (result.code !== 0) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
    const secret = result.stdout.replace(/\r?\n$/, "");
    if (Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_RECORD_INVALID",
      );
    }
    try {
      const identity = validatePreviewAgentIdentity(JSON.parse(secret));
      if (identity.nodeId !== nodeId) {
        throw new Error("Node identity mismatch.");
      }
      return identity;
    } catch {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_RECORD_INVALID",
      );
    }
  }

  async set(identity: PreviewAgentIdentity): Promise<void> {
    const validated = validatePreviewAgentIdentity(identity);
    const secret = JSON.stringify(validated);
    if (Buffer.byteLength(secret, "utf8") > MAX_SECRET_BYTES) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_RECORD_INVALID",
      );
    }
    let result: SecretToolResult;
    try {
      result = await this.run(
        [
          "store",
          "--label=EngineeringOS Preview Agent identity",
          SERVICE_ATTRIBUTE,
          SERVICE_NAME,
          NODE_ATTRIBUTE,
          validated.nodeId,
        ],
        secret,
      );
    } catch {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
    if (result.code !== 0) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
  }

  async delete(nodeId: string): Promise<void> {
    if (!isUuid(nodeId)) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_RECORD_INVALID",
      );
    }
    let result: SecretToolResult;
    try {
      result = await this.run(
        [
          "clear",
          SERVICE_ATTRIBUTE,
          SERVICE_NAME,
          NODE_ATTRIBUTE,
          nodeId,
        ],
        "",
      );
    } catch {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
    if (
      result.code !== 0 &&
      !(result.code === 1 && result.stderr.trim().length === 0)
    ) {
      throw new PreviewAgentSecretStoreError(
        "PREVIEW_AGENT_SECRET_SERVICE_UNAVAILABLE",
      );
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
