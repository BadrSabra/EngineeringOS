import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PROC_ROOT = "/proc";
const DEFAULT_TERM_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(SCRIPT_DIR, "..");

function isNodeExecutable(command) {
  return command === "node" || command.endsWith("/node") || command.endsWith("/nodejs");
}

/**
 * Only match the process started by this artifact's `start` script. In
 * particular, command-line matching without a cwd check could terminate an
 * unrelated checkout running the same dist command.
 */
export async function isApiProcess(pid, {
  procRoot = DEFAULT_PROC_ROOT,
  apiDir = API_DIR,
  read = readFile,
  resolvePath = realpath,
} = {}) {
  const commandLine = (await read(path.join(procRoot, String(pid), "cmdline")))
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (
    !isNodeExecutable(commandLine[0] ?? "") ||
    !commandLine.includes("--enable-source-maps") ||
    !commandLine.includes("./dist/index.mjs")
  ) {
    return false;
  }

  const processCwd = await resolvePath(path.join(procRoot, String(pid), "cwd"));
  return processCwd === await resolvePath(apiDir);
}

async function processIsAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH means the process has exited. EPERM means it still exists but
    // cannot be probed by this user, so fail closed and treat it as alive.
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

export async function waitForProcessExit(pid, {
  timeoutMs = DEFAULT_TERM_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
  kill = process.kill,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await processIsAlive(pid, kill))) return true;
    await sleep(intervalMs);
  }
  return !(await processIsAlive(pid, kill));
}

export async function stopOldApi({
  procRoot = DEFAULT_PROC_ROOT,
  currentPid = process.pid,
  apiDir = API_DIR,
  list = readdir,
  read = readFile,
  resolvePath = realpath,
  kill = process.kill,
  timeoutMs = DEFAULT_TERM_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
  sleep,
} = {}) {
  const processEntries = await list(procRoot);
  const stopped = [];

  for (const entry of processEntries) {
    if (!/^\d+$/.test(entry) || Number(entry) === currentPid) continue;

    const pid = Number(entry);
    try {
      if (!(await isApiProcess(pid, { procRoot, apiDir, read, resolvePath }))) continue;
      kill(pid, "SIGTERM");
      stopped.push(pid);

      if (!(await waitForProcessExit(pid, { timeoutMs, intervalMs, kill, sleep }))) {
        console.warn(`API process ${pid} did not exit after SIGTERM; sending SIGKILL`);
        kill(pid, "SIGKILL");
        if (!(await waitForProcessExit(pid, { timeoutMs, intervalMs, kill, sleep }))) {
          throw new Error(`API process ${pid} did not exit after SIGKILL`);
        }
      }
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ESRCH") continue;
      throw error;
    }
  }

  if (stopped.length > 0) {
    console.log(`Stopped stale API process(es): ${stopped.join(", ")}`);
  }
  return stopped;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  stopOldApi().catch((error) => {
    console.error("Failed to stop stale API process:", error);
    process.exitCode = 1;
  });
}