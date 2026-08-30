import { mkdtemp } from "node:fs/promises";
import path from "node:path";

/**
 * Validation and campaign sandboxes must not inherit TMPDIR. In this
 * environment TMPDIR may point at the registered delivery tree, where copied
 * artifact metadata is discovered as live workflows.
 */
export const HOST_DISPOSABLE_TEMP_ROOT = "/tmp";

export function disposableTempPath(prefix: string): string {
  if (!/^[a-z0-9][a-z0-9-]*-$/i.test(prefix)) {
    throw new Error("Disposable temp prefixes must be simple names ending with '-'.");
  }
  return path.join(HOST_DISPOSABLE_TEMP_ROOT, prefix);
}

export function createHostDisposableTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(disposableTempPath(prefix));
}