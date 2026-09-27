import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, readlink, stat } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeProcessTree } from "./runtime-listener-process.js";

export const CHILD_ATTESTATION_ENV_NAME = "ENGINEERINGOS_CHILD_ATTESTATION";

const MAX_ENVIRONMENT_BYTES = 1024 * 1024;
const ENVIRONMENT_DIGEST_NAMES = new Set([
  "BASE_PATH",
  "HOME",
  "LANG",
  "NODE_ENV",
  "PATH",
  "PORT",
  "PNPM_HOME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
]);

export type ChildProcessAttestationBinding = {
  projectId: string;
  sessionId: string;
  executionId: string;
  executionAttempt: number;
  episodeId: string;
  operationId: string;
  revision: string;
  processRole?: "validator" | "runtime_listener" | "validator_tree";
  validatorProfile?: string;
};

export type ChildProcessAttestationIdentity = Omit<
  ChildProcessAttestationBinding,
  "sessionId" | "processRole" | "validatorProfile"
>;

export type ChildProcessEnvironmentAttestation = {
  status: "known" | "mismatch" | "unknown";
  reasonCode:
    | "child_process_observed"
    | "child_environment_mismatch"
    | "binding_missing"
    | "binding_mismatch"
    | "marker_unavailable"
    | "procfs_unavailable"
    | "process_unavailable"
    | "process_root_mismatch"
    | "process_changed"
    | "unsupported_platform";
  bindingDigest: string | null;
  attestationDigest: string | null;
  processEnvironmentDigest: string | null;
  observedAt: string;
};

type ValidationProcessTreeAttestation = {
  status: "known" | "mismatch" | "unknown";
  reasonCode:
    | "process_tree_observed"
    | "child_environment_mismatch"
    | "process_root_mismatch"
    | "process_tree_changed"
    | "process_tree_unavailable"
    | "process_tree_truncated"
    | "process_tree_descendant_unavailable"
    | "process_unavailable"
    | "procfs_unavailable"
    | "binding_missing"
    | "unsupported_platform";
  bindingDigest: string | null;
  treeDigest: string | null;
  treeDigestVersion: "validator-process-tree-v1";
  processEnvironmentDigest: string | null;
  visibleProcessCount: number | null;
  sampledProcessCount: number | null;
  observedAt: string;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function childProcessBindingDigest(binding: ChildProcessAttestationBinding): string {
  const base = [
    "child-process-binding-v1",
    binding.projectId,
    binding.sessionId,
    binding.executionId,
    binding.executionAttempt,
    binding.episodeId,
    binding.operationId,
    binding.revision,
  ];
  if (binding.processRole === undefined && binding.validatorProfile === undefined) {
    return sha256(JSON.stringify(base));
  }
  return sha256(JSON.stringify([
    "child-process-binding-v2",
    ...base.slice(1),
    binding.processRole ?? null,
    binding.validatorProfile ?? null,
  ]));
}

function unknown(
  reasonCode: ChildProcessEnvironmentAttestation["reasonCode"],
  observedAt: string,
  binding?: ChildProcessAttestationBinding,
): ChildProcessEnvironmentAttestation {
  return {
    status: "unknown",
    reasonCode,
    bindingDigest: binding ? childProcessBindingDigest(binding) : null,
    attestationDigest: null,
    processEnvironmentDigest: null,
    observedAt,
  };
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }

  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const chunk = Buffer.alloc(Math.min(16 * 1024, maxBytes - totalBytes + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
      totalBytes += bytesRead;
    }
    if (totalBytes > maxBytes) return null;
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await file.close();
  }
}

function processStartTime(statLine: string): string | null {
  const commandEnd = statLine.lastIndexOf(")");
  if (commandEnd < 0) return null;
  const fields = statLine.slice(commandEnd + 1).trim().split(/\s+/);
  // The first token is stat field 3 (state); starttime is field 22.
  return fields[19] ?? null;
}

function environmentValues(environment: Buffer): Map<string, Buffer[]> {
  const values = new Map<string, Buffer[]>();
  let offset = 0;
  while (offset < environment.length) {
    const end = environment.indexOf(0, offset);
    const entryEnd = end < 0 ? environment.length : end;
    const equals = environment.indexOf(61, offset);
    if (equals > offset && equals < entryEnd) {
      const name = environment.toString("ascii", offset, equals);
      const shouldRetain = name === CHILD_ATTESTATION_ENV_NAME
        || ENVIRONMENT_DIGEST_NAMES.has(name)
        || name.startsWith("LC_");
      if (shouldRetain) {
        const entries = values.get(name) ?? [];
        entries.push(environment.subarray(equals + 1, entryEnd));
        values.set(name, entries);
      }
    }
    offset = entryEnd + 1;
  }
  return values;
}

/**
 * Project the exact safe environment keys expected from a server-spawned child.
 * Values are used only for in-memory comparison and are never returned.
 */
export function childProcessExpectedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const expected: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (
      typeof value === "string"
      && name !== CHILD_ATTESTATION_ENV_NAME
      && (ENVIRONMENT_DIGEST_NAMES.has(name) || name.startsWith("LC_"))
    ) {
      expected[name] = value;
    }
  }
  return expected;
}

function oneValue(values: Map<string, Buffer[]>, name: string): Buffer | undefined {
  const entries = values.get(name);
  return entries?.length === 1 ? entries[0] : undefined;
}

function environmentDigest(values: Map<string, Buffer[]>): string | null {
  const digest = createHash("sha256");
  const names = [...values.keys()]
    .filter((name) => name !== CHILD_ATTESTATION_ENV_NAME)
    .sort();
  for (const name of names) {
    const value = oneValue(values, name);
    if (!value) return null;
    digest.update(name);
    digest.update("\0");
    digest.update(value);
    digest.update("\0");
  }
  return names.length > 0 ? digest.digest("hex") : null;
}

function markerMatches(observed: Buffer | undefined, expected: string): boolean {
  if (!observed) return false;
  const expectedBytes = Buffer.from(expected);
  return observed.length === expectedBytes.length && timingSafeEqual(observed, expectedBytes);
}

function isWithinRoot(root: string, cwd: string): boolean {
  const relative = path.relative(root, cwd);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/**
 * Read the server-generated marker and a bounded safe environment projection
 * from procfs. Raw environment bytes are never returned or logged.
 */
export async function attestChildProcessEnvironment(input: {
  pid: number | null | undefined;
  projectRoot: string;
  marker: string | null | undefined;
  binding?: ChildProcessAttestationBinding;
  expectedEnvironment?: Readonly<Record<string, string>>;
  observedAt?: string;
}): Promise<ChildProcessEnvironmentAttestation> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (!input.binding) return unknown("binding_missing", observedAt);
  if (process.platform !== "linux") return unknown("unsupported_platform", observedAt, input.binding);
  if (!input.marker || !Number.isInteger(input.pid) || (input.pid ?? 0) <= 0) {
    return unknown("process_unavailable", observedAt, input.binding);
  }

  const pid = input.pid!;
  const procRoot = `/proc/${pid}`;
  let environment: Buffer | null = null;
  try {
    const [beforeStat, cwdLink, executable, canonicalRoot, rootStat] = await Promise.all([
      readBoundedFile(`${procRoot}/stat`, 16 * 1024),
      readlink(`${procRoot}/cwd`),
      readlink(`${procRoot}/exe`),
      realpath(input.projectRoot),
      stat(input.projectRoot),
    ]);
    if (!beforeStat) return unknown("process_unavailable", observedAt, input.binding);
    const startTime = processStartTime(beforeStat.toString("utf8"));
    if (!startTime) return unknown("process_unavailable", observedAt, input.binding);
    const canonicalCwd = await realpath(cwdLink);
    if (!isWithinRoot(canonicalRoot, canonicalCwd)) {
      return {
        ...unknown("process_root_mismatch", observedAt, input.binding),
        status: "mismatch",
      };
    }

    environment = await readBoundedFile(`${procRoot}/environ`, MAX_ENVIRONMENT_BYTES);
    if (!environment) return unknown("procfs_unavailable", observedAt, input.binding);
    const values = environmentValues(environment);
    const observedMarker = oneValue(values, CHILD_ATTESTATION_ENV_NAME);
    const observedEnvironmentDigest = environmentDigest(values);
    if (!observedEnvironmentDigest) {
      return unknown("procfs_unavailable", observedAt, input.binding);
    }

    let expectedEnvironmentMatched = true;
    for (const [name, expectedValue] of Object.entries(input.expectedEnvironment ?? {})) {
      const value = oneValue(values, name);
      if (!value || !value.equals(Buffer.from(expectedValue))) {
        expectedEnvironmentMatched = false;
      }
    }

    const [afterStat, afterCwd, afterExecutable] = await Promise.all([
      readBoundedFile(`${procRoot}/stat`, 16 * 1024),
      readlink(`${procRoot}/cwd`),
      readlink(`${procRoot}/exe`),
    ]);
    if (
      !afterStat
      || processStartTime(afterStat.toString("utf8")) !== startTime
      || afterCwd !== cwdLink
      || afterExecutable !== executable
    ) {
      return unknown("process_changed", observedAt, input.binding);
    }

    const bindingDigest = childProcessBindingDigest(input.binding);
    const markerHash = sha256(input.marker);
    const processDigest = sha256(JSON.stringify({
      pid,
      startTime,
      cwdIdentity: sha256(canonicalCwd),
      executableIdentity: sha256(executable),
      rootDevice: rootStat.dev,
      rootInode: rootStat.ino,
    }));
    const matched = markerMatches(observedMarker, input.marker) && expectedEnvironmentMatched;
    const status = matched ? "known" : "mismatch";
    const reasonCode = matched ? "child_process_observed" : "child_environment_mismatch";
    const attestationDigest = sha256(JSON.stringify({
      schema: "child-process-environment-attestation-v1",
      status,
      bindingDigest,
      markerHash,
      processEnvironmentDigest: observedEnvironmentDigest,
      processDigest,
      observedAt,
    }));

    return {
      status,
      reasonCode,
      bindingDigest,
      attestationDigest,
      processEnvironmentDigest: observedEnvironmentDigest,
      observedAt,
    };
  } catch {
    return unknown("procfs_unavailable", observedAt, input.binding);
  } finally {
    // The procfs snapshot may contain credentials unrelated to this proof.
    environment?.fill(0);
  }
}

function treeUnknown(
  reasonCode: ValidationProcessTreeAttestation["reasonCode"],
  observedAt: string,
  binding?: ChildProcessAttestationBinding,
  visibleProcessCount: number | null = null,
  sampledProcessCount: number | null = null,
  treeDigest: string | null = null,
  processEnvironmentDigest: string | null = null,
): ValidationProcessTreeAttestation {
  return {
    status: "unknown",
    reasonCode,
    bindingDigest: binding ? childProcessBindingDigest(binding) : null,
    treeDigest,
    treeDigestVersion: "validator-process-tree-v1",
    processEnvironmentDigest,
    visibleProcessCount,
    sampledProcessCount,
    observedAt,
  };
}

function sameTree(
  first: Awaited<ReturnType<typeof resolveRuntimeProcessTree>>,
  second: Awaited<ReturnType<typeof resolveRuntimeProcessTree>>,
): boolean {
  if (!first || !second || first.descendants.size !== second.descendants.size) return false;
  for (const pid of first.descendants) {
    const left = first.processes.get(pid);
    const right = second.processes.get(pid);
    if (!left || !right
      || left.parentPid !== right.parentPid
      || left.startTime !== right.startTime) return false;
  }
  return true;
}

/**
 * Attest a bounded, point-in-time validator process tree. This deliberately
 * does not make any claim about process identity after this observation.
 */
export async function attestValidatorProcessTreeEnvironment(input: {
  pid: number | null | undefined;
  projectRoot: string;
  marker: string | null | undefined;
  binding?: ChildProcessAttestationBinding;
  expectedEnvironment?: Readonly<Record<string, string>>;
  observedAt?: string;
}): Promise<ValidationProcessTreeAttestation> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (!input.binding || input.binding.processRole !== "validator_tree") {
    return treeUnknown("binding_missing", observedAt, input.binding);
  }
  if (process.platform !== "linux") return treeUnknown("unsupported_platform", observedAt, input.binding);
  if (!input.marker || !Number.isInteger(input.pid) || (input.pid ?? 0) <= 0) {
    return treeUnknown("process_unavailable", observedAt, input.binding);
  }

  const first = await resolveRuntimeProcessTree(input.pid!, 32);
  if (!first) return treeUnknown("process_tree_unavailable", observedAt, input.binding);
  if (first.truncated) return treeUnknown("process_tree_truncated", observedAt, input.binding);
  if (!first.complete) return treeUnknown("procfs_unavailable", observedAt, input.binding);
  if (!first.processes.has(input.pid!)) {
    return treeUnknown("process_unavailable", observedAt, input.binding);
  }
  if (first.descendants.size < 2) {
    return treeUnknown(
      "process_tree_descendant_unavailable",
      observedAt,
      input.binding,
      first.descendants.size,
      0,
    );
  }

  const second = await resolveRuntimeProcessTree(input.pid!, 32);
  if (!second) return treeUnknown("process_tree_unavailable", observedAt, input.binding);
  if (second.truncated) return treeUnknown("process_tree_truncated", observedAt, input.binding);
  if (!second.complete) return treeUnknown("procfs_unavailable", observedAt, input.binding);
  if (second.descendants.size < 2) {
    return treeUnknown(
      "process_tree_descendant_unavailable",
      observedAt,
      input.binding,
      second.descendants.size,
      0,
    );
  }
  if (!sameTree(first, second)) {
    return treeUnknown(
      "process_tree_changed",
      observedAt,
      input.binding,
      second.descendants.size,
      0,
    );
  }

  const bindingDigest = childProcessBindingDigest(input.binding);
  const identitySet = [...second.descendants].sort((a, b) => a - b).map((pid) => {
    const identity = second.processes.get(pid)!;
    return { pid, parentPid: identity.parentPid, startTime: identity.startTime };
  });
  const treeDigest = sha256(JSON.stringify({
    schema: "validator-process-tree-v1",
    bindingDigest,
    identities: identitySet,
  }));
  const memberEnvironmentDigests: string[] = [];
  let sampledProcessCount = 0;
  for (const pid of second.descendants) {
    sampledProcessCount += 1;
    const result = await attestChildProcessEnvironment({
      pid,
      projectRoot: input.projectRoot,
      marker: input.marker,
      binding: input.binding,
      expectedEnvironment: input.expectedEnvironment,
      observedAt,
    });
    if (result.status === "mismatch") {
      return {
        ...treeUnknown(
          result.reasonCode === "process_root_mismatch"
            ? "process_root_mismatch"
            : "child_environment_mismatch",
          observedAt,
          input.binding,
          second.descendants.size,
          sampledProcessCount,
          treeDigest,
          sha256(JSON.stringify([
            ...memberEnvironmentDigests,
            ...(result.processEnvironmentDigest ? [result.processEnvironmentDigest] : []),
          ].sort())),
        ),
        status: "mismatch",
      };
    }
    if (result.status !== "known" || !result.processEnvironmentDigest) {
      return treeUnknown(
        result.reasonCode === "process_unavailable" ? "process_unavailable" : "process_tree_descendant_unavailable",
        observedAt,
        input.binding,
        second.descendants.size,
        sampledProcessCount,
      );
    }
    memberEnvironmentDigests.push(result.processEnvironmentDigest);
  }

  const processEnvironmentDigest = sha256(JSON.stringify([...memberEnvironmentDigests].sort()));
  return {
    status: "known",
    reasonCode: "process_tree_observed",
    bindingDigest,
    treeDigest,
    treeDigestVersion: "validator-process-tree-v1",
    processEnvironmentDigest,
    visibleProcessCount: second.descendants.size,
    sampledProcessCount,
    observedAt,
  };
}