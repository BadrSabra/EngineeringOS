import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

async function readProcessGroupMembers(processGroupId, ownedRoot) {
  const entries = await readdir("/proc", { withFileTypes: true });
  const members = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const stat = await readFile(join("/proc", entry.name, "stat"), "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) continue;
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
      const state = fields[0];
      const processGroup = Number(fields[2]);
      if (state === "Z" || processGroup !== processGroupId) continue;

      const cwd = await realpath(join("/proc", entry.name, "cwd"));
      const commandLine = (await readFile(join("/proc", entry.name, "cmdline")))
        .toString("utf8")
        .replaceAll("\0", " ")
        .trim();
      if (!isWithin(ownedRoot, cwd)) {
        throw new Error(
          `Refusing to signal process group ${processGroupId}: PID ${pid} is outside its owned project root.`,
        );
      }
      members.push({ pid, cwd, commandLine });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && ["ENOENT", "ESRCH", "EACCES"].includes(error.code)) continue;
      throw error;
    }
  }
  return members.sort((left, right) => left.pid - right.pid);
}

export async function findOwnedRuntimeProcessGroups(projectRoot) {
  const ownedRoot = await realpath(projectRoot);
  const entries = await readdir("/proc", { withFileTypes: true });
  const processGroupIds = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const stat = await readFile(join("/proc", entry.name, "stat"), "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) continue;
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/u);
      if (fields[0] === "Z") continue;
      const processGroupId = Number(fields[2]);
      const cwd = await realpath(join("/proc", entry.name, "cwd"));
      if (isWithin(ownedRoot, cwd)) processGroupIds.add(processGroupId);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && ["ENOENT", "ESRCH", "EACCES"].includes(error.code)) continue;
      throw error;
    }
  }
  const groups = [];
  for (const processGroupId of [...processGroupIds].sort((left, right) => left - right)) {
    const members = await readProcessGroupMembers(processGroupId, ownedRoot);
    if (members.length > 0) {
      groups.push({
        processGroupId,
        pids: members.map((member) => member.pid),
      });
    }
  }
  return groups;
}

function signalGroup(processGroupId, signal, processApi) {
  try {
    processApi.kill(-processGroupId, signal);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

async function waitForEmptyGroup(processGroupId, ownedRoot, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  let members = await readProcessGroupMembers(processGroupId, ownedRoot);
  while (members.length > 0 && Date.now() < deadline) {
    await delay(pollMs);
    members = await readProcessGroupMembers(processGroupId, ownedRoot);
  }
  return members;
}

/**
 * Stops only the detached process group whose leader PID was recorded by the
 * lifecycle runtime. Every live group member must still have its cwd inside
 * the unique project root before either signal is sent.
 */
export async function stopOwnedRuntimeProcessGroup({
  pid,
  projectRoot,
  processApi = process,
  gracefulTimeoutMs = 1_000,
  escalationTimeoutMs = 1_000,
  pollMs = 40,
} = {}) {
  if (!Number.isInteger(pid) || pid < 2) {
    throw new Error("Runtime cleanup requires the recorded positive process-group leader PID.");
  }
  const ownedRoot = await realpath(projectRoot);
  const initialMembers = await readProcessGroupMembers(pid, ownedRoot);
  if (initialMembers.length === 0) {
    return {
      processGroupId: pid,
      initialPids: [],
      forcedPids: [],
      remainingPids: [],
    };
  }
  signalGroup(pid, "SIGTERM", processApi);
  let remaining = await waitForEmptyGroup(pid, ownedRoot, gracefulTimeoutMs, pollMs);
  const forcedPids = remaining.map((member) => member.pid);
  if (remaining.length > 0) {
    // Re-scan immediately before escalation. A group member outside the test
    // root fails closed instead of receiving SIGKILL.
    remaining = await readProcessGroupMembers(pid, ownedRoot);
    if (remaining.length > 0) {
      signalGroup(pid, "SIGKILL", processApi);
      remaining = await waitForEmptyGroup(pid, ownedRoot, escalationTimeoutMs, pollMs);
    }
  }
  if (remaining.length > 0) {
    throw new Error(
      `Runtime process group ${pid} remained after bounded cleanup: ${remaining.map((member) => member.pid).join(",")}.`,
    );
  }
  return {
    processGroupId: pid,
    initialPids: initialMembers.map((member) => member.pid),
    forcedPids,
    remainingPids: [],
  };
}
