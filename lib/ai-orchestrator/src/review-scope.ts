import { z } from "zod";
import path from "node:path";
import type { ProjectContext } from "./context-builder.js";

export const REVIEW_MAX_FILES = 5;
export const REVIEW_MAX_EXCERPT_CHARS = 1_500;
export const REVIEW_MAX_FILE_CONTENTS_BYTES = 50_000;

export const ReviewScopeSchema = z.object({
  contractVersion: z.literal(1),
  mode: z.enum(["GRAPH_METRICS", "SELECTED_FILES"]),
  bounded: z.literal(true),
  selectedFiles: z.object({
    received: z.number().int().nonnegative(),
    included: z.number().int().nonnegative(),
    omitted: z.number().int().nonnegative(),
    clippedExcerpts: z.number().int().nonnegative(),
  }).strict(),
  context: z.object({
    graphEntitiesIncluded: z.number().int().nonnegative(),
    graphRelationshipsIncluded: z.number().int().nonnegative(),
    metricsIncluded: z.boolean(),
    tasksIncluded: z.boolean(),
    eventsIncluded: z.boolean(),
    workflowsIncluded: z.boolean(),
  }).strict(),
  scanCompleteness: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
  limitations: z.array(z.string().min(1)).min(1).max(8),
}).strict();

export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

export type NormalizedReviewInputs = {
  fileContents: Record<string, string>;
  includedFilePaths: string[];
  scope: ReviewScope;
};

function countMatch(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match?.[1] ? Number.parseInt(match[1], 10) || 0 : 0;
}

function sectionAvailable(text: string, missingLabels: string[]): boolean {
  return missingLabels.every((label) => !text.includes(label));
}

function buildLimitations(scope: Omit<ReviewScope, "limitations">): string[] {
  const limitations = [
    "This is a bounded review of the supplied project evidence; approval does not mean every repository file was inspected.",
  ];
  if (scope.mode === "GRAPH_METRICS") {
    limitations.push("No selected source-file excerpts were supplied; source-level findings are limited to the bounded graph and metrics context.");
  }
  if (scope.selectedFiles.omitted > 0) {
    limitations.push(
      `${scope.selectedFiles.omitted} selected source file(s) were omitted after the ${REVIEW_MAX_FILES}-file input limit.`,
    );
  }
  if (scope.selectedFiles.clippedExcerpts > 0) {
    limitations.push(
      `${scope.selectedFiles.clippedExcerpts} selected source excerpt(s) were clipped to ${REVIEW_MAX_EXCERPT_CHARS} characters.`,
    );
  }
  if (scope.scanCompleteness !== "COMPLETE") {
    limitations.push(
      `The repository scan is ${scope.scanCompleteness.toLowerCase()}; graph and metric evidence may not cover the complete repository.`,
    );
  }
  return limitations;
}

/**
 * The only accounting path used by both the prompt and the public review
 * result. It deliberately returns paths/counts only in scope metadata; source
 * text remains confined to the prompt evidence section.
 */
export function normalizeReviewInputs(
  context: ProjectContext,
  fileContents?: Record<string, string>,
): NormalizedReviewInputs {
  const entries = Object.entries(fileContents ?? {});
  const includedEntries = entries.slice(0, REVIEW_MAX_FILES);
  const normalizedContents = Object.fromEntries(
    includedEntries.map(([file, content]) => [
      file,
      content.slice(0, REVIEW_MAX_EXCERPT_CHARS),
    ]),
  );
  const graphSummary = context.graphSummary;
  const scanCompleteness = context.contextManifest?.scanCompleteness
    ?? (context.metricsVerified ? "COMPLETE" : "UNAVAILABLE");
  const baseScope = {
    contractVersion: 1 as const,
    mode: entries.length > 0 ? "SELECTED_FILES" as const : "GRAPH_METRICS" as const,
    bounded: true as const,
    selectedFiles: {
      received: entries.length,
      included: includedEntries.length,
      omitted: Math.max(0, entries.length - includedEntries.length),
      clippedExcerpts: includedEntries.filter(([, content]) => content.length > REVIEW_MAX_EXCERPT_CHARS).length,
    },
    context: {
      graphEntitiesIncluded: countMatch(graphSummary, /^(\d+) entities total:/m),
      graphRelationshipsIncluded: countMatch(graphSummary, /Relationships \((\d+) shown\)/),
      metricsIncluded: sectionAvailable(context.latestMetrics, ["not loaded", "No metrics available", "section deferred", "section excluded"]),
      tasksIncluded: sectionAvailable(context.recentTasks, ["not loaded", "section deferred", "section excluded"]),
      eventsIncluded: sectionAvailable(context.recentEvents, ["not loaded", "section deferred", "section excluded"]),
      workflowsIncluded: sectionAvailable(context.workflows, ["not loaded", "section deferred", "section excluded"]),
    },
    scanCompleteness,
  };
  const scope = ReviewScopeSchema.parse({
    ...baseScope,
    limitations: buildLimitations(baseScope),
  });
  return {
    fileContents: normalizedContents,
    includedFilePaths: includedEntries.map(([file]) => file),
    scope,
  };
}

export function invalidReviewFileKey(fileContents: unknown): string | undefined {
  if (!fileContents || typeof fileContents !== "object" || Array.isArray(fileContents)) return undefined;
  return Object.keys(fileContents as Record<string, unknown>).find(
    (key) => path.isAbsolute(key) || key.includes(".."),
  );
}

export function reviewFileContentsBytes(fileContents: unknown): number {
  if (!fileContents || typeof fileContents !== "object" || Array.isArray(fileContents)) return 0;
  return Object.values(fileContents as Record<string, unknown>).reduce<number>(
    (sum, value) => sum + (typeof value === "string" ? value.length : 0),
    0,
  );
}