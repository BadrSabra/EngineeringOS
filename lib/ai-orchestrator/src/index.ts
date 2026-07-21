export { complete, completeRaw, MODEL_POWERFUL, MODEL_FAST } from "./groq-client.js";
export type { Message, GroqResponse, CompleteOptions, RawMessage, ToolCall, ToolDefinition, RawGroqResponse } from "./groq-client.js";

export type { PendingChange } from "./tools/file-tools.js";

export { GroqClientError } from "./errors.js";
export type { AgentErrorCode, GroqErrorCode } from "./errors.js";

export { extractJson, parseAgentResponse } from "./parsing.js";
export type { AgentParseResult } from "./parsing.js";

export {
  buildProjectContext,
  invalidateContextCache,
  setInvalidationNotifier,
  startContextInvalidationChannel,
} from "./context-builder.js";
export type { ProjectContext } from "./context-builder.js";

export * from "./schemas/index.js";

export { chat } from "./agents/chat-agent.js";
export type { ChatMessage, ChatResult } from "./agents/chat-agent.js";

export { analyzeScan } from "./agents/scan-analyst.js";
export type { ScanAnalysisResult } from "./agents/scan-analyst.js";

export { reviewCode } from "./agents/code-reviewer.js";
export type { CodeReviewResult } from "./agents/code-reviewer.js";

export { executeTask } from "./agents/task-agent.js";
export type { TaskAgentInput, TaskAgentResult } from "./agents/task-agent.js";

export { decide, validateDecision, executeDecision, orchestrateWorkflow } from "./agents/workflow-orchestrator.js";
export type { WorkflowState, OrchestrationDecision, WorkflowDecisionResult } from "./agents/workflow-orchestrator.js";
