import { and, desc, eq } from "drizzle-orm";
import { scanJobsTable } from "@workspace/db";
import type { ScanJobTransaction } from "./job-lease.js";
import type { RevisionManifest, RevisionManifestFile } from "@workspace/scanner";

export type ScanBaselineUnavailableReason =
  | "no_previous_scan"
  | "scan_finished_at_missing"
  | "scan_result_invalid"
  | "scan_not_complete"
  | "non_filesystem_scan"
  | "scanner_version_missing"
  | "scan_correlation_id_missing"
  | "manifest_missing"
  | "manifest_incomplete"
  | "manifest_invalid"
  | "derived_artifacts_incomplete";

export interface PersistedScanBaseline {
  scanJobId: string;
  scanCorrelationId: string;
  scannerVersion: string;
  manifest: RevisionManifest;
}

export type ScanBaselineReadResult =
  | { available: true; baseline: PersistedScanBaseline }
  | { available: false; reason: ScanBaselineUnavailableReason };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return false;
  }
  return !path.split(/[\\/]/).some((segment) =>
    segment.length === 0 || segment === "." || segment === "..",
  );
}

function readManifest(value: unknown): RevisionManifest | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.revision !== "string" ||
    value.revision.length === 0 ||
    typeof value.sourceRoot !== "string" ||
    value.sourceRoot.length === 0 ||
    value.completeness !== "COMPLETE" ||
    !Array.isArray(value.files)
  ) {
    return null;
  }

  const seenPaths = new Set<string>();
  const files: RevisionManifestFile[] = [];
  for (const candidate of value.files) {
    if (
      !isRecord(candidate) ||
      typeof candidate.path !== "string" ||
      !isSafeRelativePath(candidate.path) ||
      seenPaths.has(candidate.path) ||
      !Number.isSafeInteger(candidate.size) ||
      typeof candidate.size !== "number" ||
      candidate.size < 0 ||
      typeof candidate.contentHash !== "string" ||
      candidate.contentHash.length === 0 ||
      typeof candidate.oversized !== "boolean"
    ) {
      return null;
    }
    seenPaths.add(candidate.path);
    files.push({
      path: candidate.path,
      size: candidate.size,
      contentHash: candidate.contentHash,
      oversized: candidate.oversized,
    });
  }

  if (
    value.incompleteReasons !== undefined &&
    (!Array.isArray(value.incompleteReasons) || value.incompleteReasons.length > 0)
  ) {
    return null;
  }

  return {
    revision: value.revision,
    sourceRoot: value.sourceRoot,
    files,
    completeness: "COMPLETE",
  };
}

/**
 * Decode a persisted ScanJob result into an incremental-scan baseline.
 * Partial scans, non-filesystem sources, older result shapes, and incomplete
 * derived artifacts intentionally fail closed instead of being guessed.
 */
export function readPersistedScanBaseline(input: {
  scanJobId: string;
  result: unknown;
} | null | undefined): ScanBaselineReadResult {
  if (!input) return { available: false, reason: "no_previous_scan" };
  if (!isRecord(input.result)) {
    return { available: false, reason: "scan_result_invalid" };
  }

  const result = input.result;
  if (result.scanCompleteness !== "COMPLETE") {
    return { available: false, reason: "scan_not_complete" };
  }
  if (result.sourceProvenance !== "filesystem-scan") {
    return { available: false, reason: "non_filesystem_scan" };
  }
  if (typeof result.scannerVersion !== "string" || result.scannerVersion.length === 0) {
    return { available: false, reason: "scanner_version_missing" };
  }
  if (
    typeof result.scanCorrelationId !== "string" ||
    result.scanCorrelationId.length === 0
  ) {
    return { available: false, reason: "scan_correlation_id_missing" };
  }
  if (!isRecord(result.repositoryManifest)) {
    return { available: false, reason: "manifest_missing" };
  }

  const manifest = readManifest(result.repositoryManifest);
  if (!manifest) {
    if (result.repositoryManifest.completeness !== "COMPLETE") {
      return { available: false, reason: "manifest_incomplete" };
    }
    return { available: false, reason: "manifest_invalid" };
  }

  const derivedArtifacts = result.repositoryManifest.derivedArtifacts;
  if (!isRecord(derivedArtifacts) || (
    derivedArtifacts.scanner !== "COMPLETE" ||
    derivedArtifacts.graph !== "COMPLETE" ||
    derivedArtifacts.metrics !== "COMPLETE"
  )) {
    return { available: false, reason: "derived_artifacts_incomplete" };
  }

  return {
    available: true,
    baseline: {
      scanJobId: input.scanJobId,
      scanCorrelationId: result.scanCorrelationId,
      scannerVersion: result.scannerVersion,
      manifest,
    },
  };
}

/**
 * Load the most recent completed scan as a potential baseline.
 *
 * We deliberately inspect only the newest completed result. Falling back to
 * an older complete scan when the newest completed scan is partial would hide
 * a known graph gap and could make a later selective refresh unsafe.
 */
export async function loadLatestCompleteScanBaseline(
  tx: ScanJobTransaction,
  projectId: string,
): Promise<ScanBaselineReadResult> {
  const [latest] = await tx
    .select({
      id: scanJobsTable.id,
      result: scanJobsTable.result,
      finishedAt: scanJobsTable.finishedAt,
    })
    .from(scanJobsTable)
    .where(and(
      eq(scanJobsTable.projectId, projectId),
      eq(scanJobsTable.status, "completed"),
    ))
    .orderBy(
      desc(scanJobsTable.createdAt),
      desc(scanJobsTable.id),
    )
    .limit(1);

  if (!latest) return { available: false, reason: "no_previous_scan" };
  if (!latest.finishedAt) {
    return { available: false, reason: "scan_finished_at_missing" };
  }
  return readPersistedScanBaseline({ scanJobId: latest.id, result: latest.result });
}
