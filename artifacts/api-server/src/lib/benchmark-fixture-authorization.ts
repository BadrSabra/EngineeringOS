import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type BenchmarkFixtureRepairAuthorization,
  type BenchmarkFixtureRepairAuthorizationContext,
} from "@workspace/ai-orchestrator";
import { HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";

declare const disposableRootLeaseBrand: unique symbol;

export type BenchmarkDisposableRootLease = Readonly<{
  [disposableRootLeaseBrand]: true;
}>;

type LeaseRecord = {
  rootPath: string;
};

const activeLeases = new WeakMap<object, LeaseRecord>();
const BENCHMARK_ROOT_PREFIX = "engineeringos-code-agent-";

function canonicalPaths(paths: readonly string[]): string[] | undefined {
  const normalized: string[] = [];
  for (const rawPath of paths) {
    if (
      rawPath.length === 0 ||
      rawPath.includes("\0") ||
      rawPath.includes("\\") ||
      rawPath.startsWith("/") ||
      /^[A-Za-z]:/.test(rawPath)
    ) {
      return undefined;
    }
    const parts = rawPath.split("/");
    if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
      return undefined;
    }
    normalized.push(parts.join("/"));
  }
  if (new Set(normalized).size !== normalized.length) return undefined;
  return normalized.sort();
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  const a = canonicalPaths(left);
  const b = canonicalPaths(right);
  return Boolean(
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]),
  );
}

async function hasNoSymlinkTraversal(rootPath: string, relativePath: string): Promise<boolean> {
  let cursor = rootPath;
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]!);
    try {
      const entry = await fs.lstat(cursor);
      if (entry.isSymbolicLink()) return false;
      if (index < parts.length - 1 && !entry.isDirectory()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
  }
  return true;
}

/**
 * Register a root created by the isolated benchmark campaign runner.
 * The lease is an unforgeable in-process object and becomes invalid at cleanup.
 */
export async function createBenchmarkDisposableRootLease(
  rootPath: string,
): Promise<BenchmarkDisposableRootLease> {
  const canonicalRoot = await fs.realpath(rootPath);
  const stats = await fs.stat(canonicalRoot);
  if (
    !stats.isDirectory() ||
    path.dirname(canonicalRoot) !== HOST_DISPOSABLE_TEMP_ROOT ||
    !path.basename(canonicalRoot).startsWith(BENCHMARK_ROOT_PREFIX)
  ) {
    throw new Error("Benchmark fixture authorization requires a host-disposable campaign root.");
  }
  const lease = Object.freeze({}) as BenchmarkDisposableRootLease;
  activeLeases.set(lease, { rootPath: canonicalRoot });
  return lease;
}

export function revokeBenchmarkDisposableRootLease(
  lease: BenchmarkDisposableRootLease,
): void {
  activeLeases.delete(lease);
}

export async function createBenchmarkFixtureRepairAuthorization(args: {
  lease: BenchmarkDisposableRootLease;
  rootPath: string;
  projectId: string;
  caseId: string;
  allowedPaths: readonly string[];
  validationProfiles: readonly string[];
}): Promise<BenchmarkFixtureRepairAuthorization> {
  const leaseRecord = activeLeases.get(args.lease);
  const requestedRoot = await fs.realpath(args.rootPath);
  const allowedPaths = canonicalPaths(args.allowedPaths);
  const validationProfiles = [...new Set(args.validationProfiles)].sort();
  if (
    !leaseRecord ||
    leaseRecord.rootPath !== requestedRoot ||
    !allowedPaths ||
    allowedPaths.length === 0 ||
    allowedPaths.length > 8 ||
    validationProfiles.length === 0 ||
    validationProfiles.some((profile) => profile.length === 0)
  ) {
    throw new Error("Benchmark fixture authorization does not match an active isolated case.");
  }

  const authorize = async (
    context: BenchmarkFixtureRepairAuthorizationContext,
  ): Promise<boolean> => {
    const currentLease = activeLeases.get(args.lease);
    if (
      !currentLease ||
      currentLease.rootPath !== requestedRoot ||
      context.caseId !== args.caseId ||
      context.projectId !== args.projectId ||
      context.scopedFindingStatus !== "FIXTURE_PROVEN" ||
      context.rootPath === undefined ||
      context.planRootPath === undefined ||
      !samePaths(context.planPaths, allowedPaths) ||
      !samePaths(context.approvedPaths, allowedPaths) ||
      !samePaths(context.executionPaths, allowedPaths) ||
      !samePaths(context.approvedValidationProfiles, validationProfiles)
    ) {
      return false;
    }

    try {
      const contextRoot = await fs.realpath(context.rootPath);
      const planRoot = await fs.realpath(context.planRootPath);
      if (contextRoot !== requestedRoot || planRoot !== requestedRoot) return false;
    } catch {
      return false;
    }

    for (const relativePath of allowedPaths) {
      if (!(await hasNoSymlinkTraversal(requestedRoot, relativePath))) return false;
    }
    return activeLeases.has(args.lease);
  };

  return Object.freeze({
    caseId: args.caseId,
    authorize,
  });
}