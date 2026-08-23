import { z } from "zod";

export const ScanCompletenessSchema = z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]);
export type ScanCompleteness = z.infer<typeof ScanCompletenessSchema>;

export const ContextManifestSchema = z.object({
  projectId: z.string().min(1),
  projectRevision: z.string().min(1),
  scanCompleteness: ScanCompletenessSchema,
  sourceProvenance: z.string().min(1),
  scanCorrelationId: z.string().min(1).optional(),
  scannerVersion: z.string().min(1).optional(),
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
    expected.scannerVersion === actual.scannerVersion,
  );
}

export function contextManifestAllowsExecution(manifest: ContextManifest | undefined): boolean {
  return manifest?.scanCompleteness === "COMPLETE";
}