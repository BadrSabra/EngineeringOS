import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = [
  "WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH",
  "WORKSPACE_RUNTIME_SUPERVISOR_API_GID",
  "WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID",
  "WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID",
  "WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64",
  "WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.warn(
    `Workspace Runtime Supervisor disabled: secure UDS provisioning is incomplete (${missing.join(", ")}). No TCP fallback is available.`,
  );
  process.exit(0);
}

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "workspace-runtime-supervisor.mjs");
const childEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "/tmp",
  NODE_ENV: process.env.NODE_ENV ?? "production",
  WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH: process.env.WORKSPACE_RUNTIME_SUPERVISOR_SOCKET_PATH,
  WORKSPACE_RUNTIME_SUPERVISOR_API_GID: process.env.WORKSPACE_RUNTIME_SUPERVISOR_API_GID,
  WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID: process.env.WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_UID,
  WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID: process.env.WORKSPACE_RUNTIME_SUPERVISOR_CANDIDATE_GID,
  WORKSPACE_RUNTIME_SUPERVISOR_SETPRIV_PATH: process.env.WORKSPACE_RUNTIME_SUPERVISOR_SETPRIV_PATH ?? "setpriv",
  WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64: process.env.WORKSPACE_RUNTIME_SUPERVISOR_VERIFY_PUBLIC_KEY_B64,
  ...(process.env.WORKSPACE_RUNTIME_SUPERVISOR_REPLAY_LEDGER_PATH
    ? { WORKSPACE_RUNTIME_SUPERVISOR_REPLAY_LEDGER_PATH: process.env.WORKSPACE_RUNTIME_SUPERVISOR_REPLAY_LEDGER_PATH }
    : {}),
  WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON: process.env.WORKSPACE_RUNTIME_ALLOWED_ROOTS_JSON,
};

const child = spawn(process.execPath, [scriptPath], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: "inherit",
});
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));
child.once("error", (error) => {
  console.error(`Workspace Runtime Supervisor could not start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
