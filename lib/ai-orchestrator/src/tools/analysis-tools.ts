import type { ToolDefinition } from "./file-tools.js";

export type AnalysisToolStatus = "complete" | "unavailable" | "failed";

export type AnalysisCorrelation = {
  operationId: string;
  projectRevision: string;
  evidenceProvenance: string;
};

export type AnalysisToolResult = {
  status: AnalysisToolStatus;
  output: string;
  source?: string;
  correlation?: AnalysisCorrelation;
};

export type AnalysisToolRunner = (
  name: string,
  args: Record<string, string>,
  signal?: AbortSignal,
  correlation?: AnalysisCorrelation,
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

export async function executeAnalysisTool(
  name: string,
  args: Record<string, string>,
  runner: AnalysisToolRunner | undefined,
  signal?: AbortSignal,
  correlation?: AnalysisCorrelation,
): Promise<AnalysisToolResult> {
  if (!ANALYSIS_TOOL_NAMES.has(name)) {
    return { status: "failed", output: `Unknown analysis tool "${name}".` };
  }
  if (!runner) {
    return {
      status: "unavailable",
      output: `Analysis tool "${name}" is unavailable for this project turn; do not present its result as completed evidence.`,
      correlation,
    };
  }
  if (signal?.aborted) {
    return {
      status: "unavailable",
      output: "Analysis was cancelled before it started.",
      correlation,
    };
  }
  try {
    if (!correlation) {
      return {
        status: "unavailable",
        output: "Analysis correlation is unavailable for this project turn; do not present its result as completed evidence.",
      };
    }
    const result = await runner(name, args, signal, correlation);
    if (result.status !== "complete") {
      return {
        ...result,
        output: `${result.output}\nThis analysis result is not completed evidence.`,
      };
    }
    if (
      !result.correlation ||
      result.correlation.operationId !== correlation.operationId ||
      result.correlation.projectRevision !== correlation.projectRevision ||
      !result.correlation.evidenceProvenance
    ) {
      return {
        status: "unavailable",
        output: "Analysis returned stale or cross-operation evidence; it was rejected.",
      };
    }
    return result;
  } catch {
    return {
      status: signal?.aborted ? "unavailable" : "failed",
      output: signal?.aborted
        ? "Analysis was cancelled before it completed."
        : `Analysis tool "${name}" failed and produced no completed evidence.`,
      correlation,
    };
  }
}