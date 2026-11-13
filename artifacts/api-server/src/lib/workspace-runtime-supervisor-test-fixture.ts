import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmod, chown, lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/workspace-runtime-supervisor.mjs",
);

export type WorkspaceRuntimeSupervisorTestFixture = {
  child: ChildProcess;
  socketPath: string;
  controlDirectory: string;
  signingPrivateKeyBase64: string;
  verifyPublicKeyBase64: string;
  clientEnvironment: Record<string, string>;
  stop(): Promise<void>;
};

export async function startWorkspaceRuntimeSupervisorTestFixture(input: {
  allowedRoots?: string[];
  extraEnvironment?: Record<string, string>;
  timeoutMs?: number;
} = {}): Promise<WorkspaceRuntimeSupervisorTestFixture> {
  if (process.platform !== "linux" || !process.getuid || !process.getgid) {
    throw new Error("Workspace runtime supervisor UDS tests require Linux.");
  }
  const apiGid = process.getgid() > 0 ? process.getgid() : 65_533;
  const runnerUid = process.getuid();
  const candidateUid = runnerUid > 0 ? runnerUid : 65_534;
  const candidateGid = apiGid === 65_534 ? 65_533 : apiGid;

  const controlDirectory = await mkdtemp(path.join(os.tmpdir(), "eos-supervisor-test-"));
  try {
    await chown(controlDirectory, runnerUid, apiGid);
    await chmod(controlDirectory, 0o2710);
  } catch (error) {
    await rm(controlDirectory, { recursive: true, force: true });
    throw new Error(`Could not provision the test supervisor control directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  const socketPath = path.join(controlDirectory, "control.sock");
  const pair = generateKeyPairSync("ed25519");
  const signingPrivateKeyBase64 = pair.privateKey.export({
    format: "der",
    type: "pkcs8",
  }).toString("base64");
  const verifyPublicKeyBase64 = pair.publicKey.export({
    format: "der",
    type: "spki",
  }).toString("base64");

  const child = spawn(process.execPath, [scriptPath], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? os.tmpdir(),
      NODE_ENV: "test",
      WORKSPACE_RUNTIME_SUPERVISOR_TEST_MODE: "1",
      WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH: socketPath,
      WORKSPACE_RUNTIME_SUPERVISOR_API_GID: String(apiGid),
      WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID: String(candidateUid),
      WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID: String(candidateGid),
      WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64: verifyPublicKeyBase64,
      WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON: JSON.stringify(input.allowedRoots ?? [os.tmpdir()]),
      ...input.extraEnvironment,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });

  const timeoutMs = input.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Supervisor exited before creating its socket: ${stderr}`);
      }
      try {
        if ((await lstat(socketPath)).isSocket()) break;
      } catch {
        // Wait for the service to bind the socket.
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!(await lstat(socketPath).then((info) => info.isSocket()).catch(() => false))) {
      throw new Error(`Supervisor Unix socket was not ready: ${stderr}`);
    }
  } catch (error) {
    child.kill("SIGKILL");
    await rm(controlDirectory, { recursive: true, force: true });
    throw error;
  }

  const clientEnvironment = {
    NODE_ENV: "test",
    WORKSPACE_RUNTIME_SUPERVISOR_TEST_MODE: "1",
    WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH: socketPath,
    WORKSPACE_RUNTIME_SUPERVISOR_SIGNING_PRIVATE_KEY_B64: signingPrivateKeyBase64,
  };

  let stopped = false;
  return {
    child,
    socketPath,
    controlDirectory,
    signingPrivateKeyBase64,
    verifyPublicKeyBase64,
    clientEnvironment,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGTERM");
        await Promise.race([
          exited,
          new Promise((resolve) => setTimeout(resolve, 3_000)),
        ]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await Promise.race([
            exited,
            new Promise((resolve) => setTimeout(resolve, 1_000)),
          ]);
        }
      }
      await rm(controlDirectory, { recursive: true, force: true });
    },
  };
}
