import { z } from "zod";

export const ScanCompletenessSchema = z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]);
export type ScanCompleteness = z.infer<typeof ScanCompletenessSchema>;

const RevisionManifestFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  oversized: z.boolean(),
}).strict();

export const RepositoryRevisionManifestSchema = z.object({
  revision: z.string().min(1),
  sourceRoot: z.string().min(1),
  files: z.array(RevisionManifestFileSchema),
  completeness: ScanCompletenessSchema,
  derivedArtifacts: z.object({
    scanner: ScanCompletenessSchema,
    graph: ScanCompletenessSchema,
    metrics: ScanCompletenessSchema,
  }).strict().optional(),
}).strict();
export type RepositoryRevisionManifest = z.infer<typeof RepositoryRevisionManifestSchema>;

export const ContextManifestSchema = z.object({
  projectId: z.string().min(1),
  projectRevision: z.string().min(1),
  scanCompleteness: ScanCompletenessSchema,
  sourceProvenance: z.string().min(1),
  scanCorrelationId: z.string().min(1).optional(),
  scannerVersion: z.string().min(1).optional(),
  repositoryManifest: RepositoryRevisionManifestSchema.optional(),
  capturedAt: z.string().datetime(),
}).strict().transform((manifest) => {
  // Keep compatibility with older consumers that treated every context
  // metadata value as a non-empty string and only inspected `.length`.
  Object.defineProperty(manifest, "length", { value: 1, enumerable: false });
  return manifest;
});

export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export function contextManifestMatches(
  expected: ContextManifest | undefined,
  actual: ContextManifest | undefined,
): boolean {
  return Boolean(
    expected &&
    actual &&
    expected.projectId === actual.projectId &&
    expected.projectRevision === actual.projectRevision &&
    expected.scanCompleteness === actual.scanCompleteness &&
    expected.sourceProvenance === actual.sourceProvenance &&
    expected.scanCorrelationId === actual.scanCorrelationId &&
    expected.scannerVersion === actual.scannerVersion &&
    (!expected.repositoryManifest || (
      actual.repositoryManifest?.revision === expected.repositoryManifest.revision &&
      actual.repositoryManifest.sourceRoot === expected.repositoryManifest.sourceRoot &&
      actual.repositoryManifest.completeness === expected.repositoryManifest.completeness
    )),
  );
}

export function contextManifestAllowsExecution(manifest: ContextManifest | undefined): boolean {
  const repositoryManifest = manifest?.repositoryManifest;
  return Boolean(
    manifest?.scanCompleteness === "COMPLETE" &&
    manifest.scanCorrelationId &&
    repositoryManifest &&
    repositoryManifest.revision === manifest.projectRevision &&
    repositoryManifest.sourceRoot.length > 0 &&
    repositoryManifest.completeness === "COMPLETE",
  );
}