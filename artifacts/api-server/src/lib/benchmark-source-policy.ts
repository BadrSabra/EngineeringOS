/**
 * Single source of truth for the benchmark source attestation.
 *
 * The runner and release gate must reject different revisions in exactly the
 * same way. Keep this policy server-owned and do not let a live campaign
 * override it through an environment variable.
 */

export const APPROVED_BENCHMARK_SOURCE_REVISION =
  "b234a1970fcf2f9f47f742e8e7fd0bd47a9d226a";

const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;

export function isValidBenchmarkSourceRevision(value: string): boolean {
  return SOURCE_REVISION_PATTERN.test(value);
}

export function isApprovedBenchmarkSourceRevision(value: string): boolean {
  return isValidBenchmarkSourceRevision(value) &&
    value === APPROVED_BENCHMARK_SOURCE_REVISION;
}