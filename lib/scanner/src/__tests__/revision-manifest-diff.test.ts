import { describe, expect, it } from "vitest";
import type { RevisionManifest } from "../file-walker.js";
import { planRevisionManifestDiff } from "../revision-manifest-diff.js";

const ROOT = "/workspace/project";
const VERSION = "1.0.0";

function file(
  path: string,
  contentHash: string,
  overrides: Partial<RevisionManifest["files"][number]> = {},
): RevisionManifest["files"][number] {
  return {
    path,
    size: 10,
    contentHash,
    oversized: false,
    ...overrides,
  };
}

function manifest(
  revision: string,
  files: RevisionManifest["files"],
  overrides: Partial<RevisionManifest> = {},
): RevisionManifest {
  return {
    revision,
    sourceRoot: ROOT,
    files,
    completeness: "COMPLETE",
    ...overrides,
  };
}

describe("planRevisionManifestDiff", () => {
  it("returns a deterministic no-op plan for identical complete snapshots", () => {
    const files = [file("src/a.ts", "hash-a"), file("src/z.ts", "hash-z")];
    const result = planRevisionManifestDiff(
      manifest("same-revision", files),
      manifest("same-revision", [...files].reverse()),
      { previousScannerVersion: VERSION, currentScannerVersion: VERSION },
    );

    expect(result).toEqual({
      mode: "incremental",
      sourceRoot: ROOT,
      previousRevision: "same-revision",
      currentRevision: "same-revision",
      scannerVersion: VERSION,
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      unchangedPaths: ["src/a.ts", "src/z.ts"],
      affectedPaths: [],
    });
  });

  it("classifies added, modified, deleted, and unchanged files in stable path order", () => {
    const previous = manifest("revision-before", [
      file("src/keep.ts", "keep"),
      file("src/old.ts", "old"),
      file("src/change.ts", "before"),
    ]);
    const current = manifest("revision-after", [
      file("src/new.ts", "new"),
      file("src/change.ts", "after"),
      file("src/keep.ts", "keep"),
    ]);

    const result = planRevisionManifestDiff(previous, current, {
      previousScannerVersion: VERSION,
      currentScannerVersion: VERSION,
    });

    expect(result).toMatchObject({
      mode: "incremental",
      addedPaths: ["src/new.ts"],
      modifiedPaths: ["src/change.ts"],
      deletedPaths: ["src/old.ts"],
      unchangedPaths: ["src/keep.ts"],
      affectedPaths: ["src/change.ts", "src/new.ts", "src/old.ts"],
    });
  });

  it("treats a changed size or oversized flag as a modification", () => {
    const previous = manifest("before", [
      file("src/a.ts", "same-hash"),
      file("src/b.ts", "same-hash", { oversized: true }),
    ]);
    const current = manifest("after", [
      file("src/a.ts", "same-hash", { size: 11 }),
      file("src/b.ts", "same-hash", { oversized: false }),
    ]);

    const result = planRevisionManifestDiff(previous, current, {
      previousScannerVersion: VERSION,
      currentScannerVersion: VERSION,
    });

    expect(result).toMatchObject({
      mode: "incremental",
      modifiedPaths: ["src/a.ts", "src/b.ts"],
    });
  });

  it.each([
    ["missing baseline", undefined, manifest("current", []), { currentScannerVersion: VERSION }, "no_previous_manifest"],
    [
      "partial baseline",
      manifest("before", [], { completeness: "PARTIAL" }),
      manifest("after", []),
      { previousScannerVersion: VERSION, currentScannerVersion: VERSION },
      "previous_manifest_partial",
    ],
    [
      "partial current scan",
      manifest("before", []),
      manifest("after", [], { completeness: "PARTIAL" }),
      { previousScannerVersion: VERSION, currentScannerVersion: VERSION },
      "current_manifest_partial",
    ],
    [
      "changed source root",
      manifest("before", []),
      manifest("after", [], { sourceRoot: "/workspace/other" }),
      { previousScannerVersion: VERSION, currentScannerVersion: VERSION },
      "source_root_changed",
    ],
    [
      "changed scanner version",
      manifest("before", []),
      manifest("after", []),
      { previousScannerVersion: "0.9.0", currentScannerVersion: VERSION },
      "scanner_version_changed",
    ],
    [
      "unknown baseline scanner version",
      manifest("before", []),
      manifest("after", []),
      { currentScannerVersion: VERSION },
      "scanner_version_changed",
    ],
    [
      "inconsistent revision digest",
      manifest("same", [file("src/a.ts", "before")]),
      manifest("same", [file("src/a.ts", "after")]),
      { previousScannerVersion: VERSION, currentScannerVersion: VERSION },
      "revision_inconsistent",
    ],
  ] as const)(
    "falls back to a full refresh for %s",
    (_label, previous, current, options, reason) => {
      expect(planRevisionManifestDiff(previous, current, options)).toEqual({
        mode: "full",
        reason,
      });
    },
  );

  it("rejects duplicate and unsafe manifest paths instead of diffing them", () => {
    const duplicate = manifest("before", [
      file("src/a.ts", "one"),
      file("src/a.ts", "two"),
    ]);
    const unsafe = manifest("after", [file("../outside.ts", "outside")]);

    expect(planRevisionManifestDiff(duplicate, manifest("current", []), {
      previousScannerVersion: VERSION,
      currentScannerVersion: VERSION,
    })).toEqual({ mode: "full", reason: "invalid_manifest" });

    expect(planRevisionManifestDiff(manifest("before", []), unsafe, {
      previousScannerVersion: VERSION,
      currentScannerVersion: VERSION,
    })).toEqual({ mode: "full", reason: "invalid_manifest" });
  });
});
