import type { ToolDefinition } from "./file-tools.js";

export type AnalysisToolStatus = "complete" | "unavailable" | "failed";
export type AnalysisFailureCategory =
  | "timeout"
  | "cancellation"
  | "stale_revision"
  | "unavailable_dependency"
  | "root_unavailable"
  | "execution_failure";

export type AnalysisCorrelation = {
  operationId: string;
  projectId: string;
  projectRevision: string;
  rootAvailable: boolean;
  evidenceProvenance: string;
};

export type AnalysisToolResult = {
  status: AnalysisToolStatus;
  output: string;
  source?: string;
  correlation?: AnalysisCorrelation;
  failureCategory?: AnalysisFailureCategory;
  /** Set only by the server-owned runner when it advances its revision snapshot. */
  trustedRevisionAdvance?: boolean;
};

export type AnalysisToolRunner = (
  name: string,
  args: Record<string, string>,
  signal?: AbortSignal,
  correlation?: AnalysisCorrelation,
  deadlineAt?: number,
) => Promise<AnalysisToolResult>;

export const ANALYSIS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "refresh_project_scan",
      description:
        "Refresh the persisted project scanner and return bounded, current scan evidence. Read-only for the agent; never invent a scan result when the refresh is unavailable or fails.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_knowledge_graph",
      description:
        "Query the persisted dependency/knowledge graph. Use operation search, impact, or neighborhood with a bounded depth and result set.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["search", "impact", "neighborhood"] },
          entity: { type: "string", description: "Entity name or ID for impact/neighborhood." },
          depth: { type: "integer", minimum: 1, maximum: 4 },
        },
        required: ["operation"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_project_apis",
      description:
        "Return APIs discovered in the persisted project graph, optionally filtered by a bounded search term. This is evidence from the current graph, not a guess.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional route, handler, or API name filter." },
        },
        additionalProperties: false,
      },
    },
  },
];

export const ANALYSIS_TOOL_NAMES = new Set(
  ANALYSIS_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

function safeStatusMessage(name: string, status: Exclude<AnalysisToolStatus, "complete">): string {
  return status === "unavailable"
    ? `Analysis tool "${name}" was unavailable; the operation did not complete.`
    : `Analysis tool "${name}" failed; the operation did not complete.`;
}

export async function executeAnalysisTool(
  name: string,
  args: Record<string, string>,
  runner: AnalysisToolRunner | undefined,
  signal?: AbortSignal,
  correlation?: AnalysisCorrelation,
  deadlineAt?: number,
): Promise<AnalysisToolResult> {
  if (!ANALYSIS_TOOL_NAMES.has(name)) {
    return { status: "failed", output: `Unknown analysis tool "${name}".` };
  }
  if (!runner) {
    return {
      status: "unavailable",
      output: `Analysis tool "${name}" is unavailable for this project turn; do not present its result as completed evidence.`,
      correlation,
      failureCategory: "unavailable_dependency",
    };
  }
  if (signal?.aborted) {
    return {
      status: "unavailable",
      output: "Analysis was cancelled before it started.",
      correlation,
      failureCategory: "cancellation",
    };
  }
  try {
    if (!correlation) {
      return {
        status: "unavailable",
        output: "Analysis correlation is unavailable for this project turn; do not present its result as completed evidence.",
      };
    }
    // Do not let an implementation mutate the request-owned envelope.
    const runnerCorrelation = { ...correlation };
    let result = await runner(name, args, signal, runnerCorrelation, deadlineAt);
    if (result.status !== "complete") {
      console.error(JSON.stringify({
        scope: "analysis-tools",
        code: result.status === "unavailable" ? "ANALYSIS_UNAVAILABLE" : "ANALYSIS_FAILED",
        tool: name,
        diagnostic: result.output,
      }));
      return {
        ...result,
        output: safeStatusMessage(name, result.status),
      };
    }
    if (
      !result.correlation ||
      result.correlation.operationId !== correlation.operationId ||
      result.correlation.projectId !== correlation.projectId ||
      (
        result.correlation.projectRevision !== correlation.projectRevision
        && result.trustedRevisionAdvance !== true
      ) ||
      result.correlation.rootAvailable !== correlation.rootAvailable ||
      !result.correlation.evidenceProvenance
    ) {
      return {
        status: "unavailable",
        output: "Analysis returned stale or cross-operation evidence; it was rejected.",
        failureCategory: "stale_revision",
      };
    }
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      scope: "analysis-tools",
      code: signal?.aborted ? "ANALYSIS_CANCELLED" : "ANALYSIS_FAILED",
      tool: name,
      error: error instanceof Error ? error.message : String(error),
    }));
      return {
      status: signal?.aborted ? "unavailable" : "failed",
      output: signal?.aborted
        ? `Analysis tool "${name}" was cancelled; the operation did not complete.`
        : safeStatusMessage(name, "failed"),
      correlation,
        failureCategory: signal?.aborted ? "cancellation" : "execution_failure",
    };
  }
}