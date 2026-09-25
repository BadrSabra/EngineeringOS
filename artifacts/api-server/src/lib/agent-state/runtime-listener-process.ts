import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

const MAX_PROC_ENTRIES = 8_192;
const MAX_FD_ENTRIES = 4_096;
const MAX_PROC_STAT_BYTES = 16 * 1024;
const MAX_TCP_TABLE_BYTES = 2 * 1024 * 1024;

type ProcessIdentity = {
  pid: number;
  parentPid: number;
  startTime: string;
};

export type RuntimeListenerProcessResolution = {
  status: "known" | "unknown";
  reasonCode:
    | "listener_owned_by_runtime_process"
    | "listener_not_found"
    | "listener_not_in_runtime_tree"
    | "listener_ambiguous"
    | "process_unavailable"
    | "process_changed"
    | "procfs_unavailable"
    | "unsupported_platform"
    | "binding_missing";
  port: number | null;
  pid: number | null;
  identityDigest: string | null;
  observedAt: string;
};

function unknown(
  reasonCode: RuntimeListenerProcessResolution["reasonCode"],
  observedAt: string,
): RuntimeListenerProcessResolution {
  return {
    status: "unknown",
    reasonCode,
    port: null,
    pid: null,
    identityDigest: null,
    observedAt,
  };
}

function parseProcessIdentity(pid: number, statLine: string): ProcessIdentity | null {
  const commandEnd = statLine.lastIndexOf(")");
  if (commandEnd < 0) return null;
  const fields = statLine.slice(commandEnd + 1).trim().split(/\s+/);
  const parentPid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(parentPid) || parentPid < 0 || !startTime || !/^\d+$/.test(startTime)) {
    return null;
  }
  return { pid, parentPid, startTime };
}

async function readProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`);
    if (stat.byteLength > MAX_PROC_STAT_BYTES) return null;
    return parseProcessIdentity(pid, stat.toString("utf8"));
  } catch {
    return null;
  }
}

export function parseListeningSocketInodes(contents: string, port: number): Set<string> {
  const inodes = new Set<string>();
  for (const line of contents.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10 || columns[3] !== "0A") continue;
    const localAddress = columns[1]!;
    const separator = localAddress.lastIndexOf(":");
    if (separator < 0) continue;
    const localPort = Number.parseInt(localAddress.slice(separator + 1), 16);
    const inode = columns[9]!;
    if (localPort === port && /^\d+$/.test(inode) && inode !== "0") inodes.add(inode);
  }
  return inodes;
}

async function readListenerInodes(port: number): Promise<Set<string> | null> {
  try {
    const [tcp, tcp6] = await Promise.all([
      fs.readFile("/proc/net/tcp"),
      fs.readFile("/proc/net/tcp6").catch((error: NodeJS.ErrnoException) => {
        // Some Linux containers disable IPv6 and omit this procfs table.
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    ]);
    if (tcp.byteLength > MAX_TCP_TABLE_BYTES || (tcp6 && tcp6.byteLength > MAX_TCP_TABLE_BYTES)) {
      return null;
    }
    const inodes = parseListeningSocketInodes(tcp.toString("utf8"), port);
    if (tcp6) {
      for (const inode of parseListeningSocketInodes(tcp6.toString("utf8"), port)) inodes.add(inode);
    }
    return inodes;
  } catch {
    return null;
  }
}

async function processTree(
  launchPid: number,
): Promise<{ processes: Map<number, ProcessIdentity>; descendants: Set<number> } | null> {
  let entries;
  try {
    entries = await fs.readdir("/proc", { withFileTypes: true });
  } catch {
    return null;
  }
  const pids = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
  if (pids.length > MAX_PROC_ENTRIES) return null;

  const processes = new Map<number, ProcessIdentity>();
  for (let offset = 0; offset < pids.length; offset += 64) {
    const chunk = pids.slice(offset, offset + 64);
    const identities = await Promise.all(chunk.map(readProcessIdentity));
    for (const identity of identities) {
      if (identity) processes.set(identity.pid, identity);
    }
  }
  if (!processes.has(launchPid)) return null;

  const children = new Map<number, number[]>();
  for (const identity of processes.values()) {
    const siblings = children.get(identity.parentPid) ?? [];
    siblings.push(identity.pid);
    children.set(identity.parentPid, siblings);
  }
  const descendants = new Set<number>([launchPid]);
  const pending = [launchPid];
  while (pending.length > 0 && descendants.size <= MAX_PROC_ENTRIES) {
    const parent = pending.pop()!;
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      pending.push(child);
    }
  }
  if (descendants.size > MAX_PROC_ENTRIES) return null;
  return { processes, descendants };
}

async function socketOwners(
  descendants: ReadonlySet<number>,
  expectedInodes: ReadonlySet<string>,
): Promise<{ owners: Map<string, Set<number>>; complete: boolean }> {
  const owners = new Map<string, Set<number>>();
  let complete = true;
  for (const pid of descendants) {
    let descriptors: string[];
    try {
      descriptors = await fs.readdir(`/proc/${pid}/fd`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      complete = false;
      continue;
    }
    if (descriptors.length > MAX_FD_ENTRIES) {
      complete = false;
      continue;
    }
    for (const descriptor of descriptors) {
      let target: string;
      try {
        target = await fs.readlink(`/proc/${pid}/fd/${descriptor}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match || !expectedInodes.has(match[1]!)) continue;
      const pids = owners.get(match[1]!) ?? new Set<number>();
      pids.add(pid);
      owners.set(match[1]!, pids);
    }
  }
  return { owners, complete };
}

/**
 * Resolve the process which owns the server-owned listening socket. Only
 * descendants of the exact runtime launch PID can be considered, and the
 * result is unknown unless every listening socket inode has one stable owner.
 */
export async function resolveRuntimeListenerProcess(input: {
  launchPid: number | null | undefined;
  port: number;
  bindingDigest: string | null | undefined;
  observedAt?: string;
}): Promise<RuntimeListenerProcessResolution> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (process.platform !== "linux") return unknown("unsupported_platform", observedAt);
  if (!input.bindingDigest || !/^[a-f0-9]{64}$/.test(input.bindingDigest)) {
    return unknown("binding_missing", observedAt);
  }
  if (
    !Number.isInteger(input.launchPid)
    || (input.launchPid ?? 0) <= 0
    || !Number.isInteger(input.port)
    || input.port <= 0
    || input.port > 65_535
  ) {
    return unknown("process_unavailable", observedAt);
  }

  const launchPid = input.launchPid!;
  const initialTree = await processTree(launchPid);
  if (!initialTree) return unknown("process_unavailable", observedAt);
  const launchIdentity = initialTree.processes.get(launchPid);
  if (!launchIdentity) return unknown("process_unavailable", observedAt);

  const listenerInodes = await readListenerInodes(input.port);
  if (!listenerInodes) return unknown("procfs_unavailable", observedAt);
  if (listenerInodes.size === 0) return unknown("listener_not_found", observedAt);

  const ownership = await socketOwners(initialTree.descendants, listenerInodes);
  if (!ownership.complete) return unknown("procfs_unavailable", observedAt);
  const ownerPids = new Set<number>();
  for (const inode of listenerInodes) {
    const owners = ownership.owners.get(inode);
    if (!owners?.size) return unknown("listener_not_in_runtime_tree", observedAt);
    for (const pid of owners) ownerPids.add(pid);
  }
  if (ownerPids.size !== 1) return unknown("listener_ambiguous", observedAt);
  const listenerPid = [...ownerPids][0]!;
  const listenerIdentity = initialTree.processes.get(listenerPid);
  if (!listenerIdentity || !initialTree.descendants.has(listenerPid)) {
    return unknown("process_unavailable", observedAt);
  }
  if ([...ownership.owners.values()].some((owners) => owners.size !== 1 || !owners.has(listenerPid))) {
    return unknown("listener_ambiguous", observedAt);
  }

  const afterTree = await processTree(launchPid);
  if (!afterTree) return unknown("procfs_unavailable", observedAt);
  const [afterListenerInodes, finalOwners] = await Promise.all([
    readListenerInodes(input.port),
    socketOwners(afterTree.descendants, listenerInodes),
  ]);
  if (!afterListenerInodes || !finalOwners.complete) {
    return unknown("procfs_unavailable", observedAt);
  }
  const afterLaunch = afterTree.processes.get(launchPid);
  const afterListener = afterTree.processes.get(listenerPid);
  const sameInodes = listenerInodes.size === afterListenerInodes.size
    && [...listenerInodes].every((inode) => afterListenerInodes.has(inode));
  const sameOwners = [...listenerInodes].every((inode) => {
    const owners = finalOwners.owners.get(inode);
    return owners?.size === 1 && owners.has(listenerPid);
  });
  if (
    afterLaunch?.startTime !== launchIdentity.startTime
    || afterListener?.startTime !== listenerIdentity.startTime
    || !afterTree.descendants.has(listenerPid)
    || !sameInodes
    || !sameOwners
  ) {
    return unknown("process_changed", observedAt);
  }

  const identityDigest = createHash("sha256").update(JSON.stringify({
    schema: "runtime-listener-process-v1",
    bindingDigest: input.bindingDigest,
    launchPid,
    launchStartTime: launchIdentity.startTime,
    listenerPid,
    listenerStartTime: listenerIdentity.startTime,
    port: input.port,
    socketInodes: [...listenerInodes].sort(),
  })).digest("hex");
  return {
    status: "known",
    reasonCode: "listener_owned_by_runtime_process",
    port: input.port,
    pid: listenerPid,
    identityDigest,
    observedAt,
  };
}