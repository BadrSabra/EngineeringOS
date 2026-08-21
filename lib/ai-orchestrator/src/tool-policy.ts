/**
 * Tool policy and capability gating for ai-orchestrator.
 *
 * This layer decides whether a provider may receive any tools at all and
 * which tool definitions are exposed in a given execution mode.
 */
import { getProvider, type ProviderId } from "./provider-registry.js";
import { FILE_TOOL_DEFINITIONS, type ToolDefinition } from "./tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, type GitToolDefinition } from "./tools/git-tools.js";
import { EXECUTION_TOOL_DEFINITIONS } from "./tools/execution-tools.js";
import { ANALYSIS_TOOL_DEFINITIONS } from "./tools/analysis-tools.js";

export type ToolMode = "workspace" | "read-only";

export type ToolDefinitionLike = ToolDefinition | GitToolDefinition;

export type ToolPolicy = {
  provider: ProviderId;
  rootPath?: string;
  mode: ToolMode;
  enabled: boolean;
  allowFileRead: boolean;
  allowFileWrite: boolean;
  allowGit: boolean;
  allowExecution: boolean;
  allowAnalysis: boolean;
  reason?: string;
};

const FILE_READ_TOOL_NAMES = new Set(["read_file", "read_file_range", "list_directory", "search_code"]);
const FILE_WRITE_TOOL_NAMES = new Set(["write_file", "replace_text"]);
const GIT_TOOL_NAMES = new Set(["git_status", "git_diff", "git_log"]);
const EXECUTION_TOOL_NAMES = new Set(EXECUTION_TOOL_DEFINITIONS.map((tool) => tool.function.name));
const ANALYSIS_TOOL_NAMES = new Set(ANALYSIS_TOOL_DEFINITIONS.map((tool) => tool.function.name));

const ALL_TOOL_DEFINITIONS: ToolDefinitionLike[] = [
  ...FILE_TOOL_DEFINITIONS,
  ...GIT_TOOL_DEFINITIONS,
  ...EXECUTION_TOOL_DEFINITIONS,
];

export function resolveToolPolicy(opts: {
  provider: ProviderId;
  rootPath?: string;
  mode?: ToolMode;
  allowExecution?: boolean;
  allowAnalysis?: boolean;
}): ToolPolicy {
  const provider = getProvider(opts.provider);
  const mode = opts.mode ?? "workspace";
  const allowExecution = opts.allowExecution === true && mode === "workspace";

  let policy: ToolPolicy;

  if (!opts.rootPath) {
    policy = {
      provider: provider.providerId,
      rootPath: opts.rootPath,
      mode,
      enabled: false,
      allowFileRead: false,
      allowFileWrite: false,
      allowGit: false,
      allowExecution: false,
      allowAnalysis: false,
      reason: "tool policy requires a project root path",
    };
  } else if (!provider.supportsTools) {
    policy = {
      provider: provider.providerId,
      rootPath: opts.rootPath,
      mode,
      enabled: false,
      allowFileRead: false,
      allowFileWrite: false,
      allowGit: false,
      allowExecution: false,
      allowAnalysis: false,
      reason: "provider registry marks this endpoint as text-only",
    };
  } else {
    policy = {
      provider: provider.providerId,
      rootPath: opts.rootPath,
      mode,
      enabled: true,
      allowFileRead: true,
      allowFileWrite: mode === "workspace",
      allowGit: true,
      allowExecution,
      allowAnalysis: opts.allowAnalysis === true,
    };
  }

  console.info(
    JSON.stringify({
      scope: "tool-policy",
      action: "resolve_tool_policy",
      provider: policy.provider,
      rootPath: opts.rootPath ?? null,
      mode,
      enabled: policy.enabled,
      allowFileRead: policy.allowFileRead,
      allowFileWrite: policy.allowFileWrite,
      allowGit: policy.allowGit,
      allowExecution: policy.allowExecution,
      allowAnalysis: policy.allowAnalysis,
      reason: policy.reason ?? null,
      supportsTools: provider.supportsTools,
    }),
  );

  return policy;
}

export function isToolAllowed(policy: ToolPolicy, toolName: string): boolean {
  if (!policy.enabled) return false;
  if (FILE_READ_TOOL_NAMES.has(toolName)) return policy.allowFileRead;
  if (FILE_WRITE_TOOL_NAMES.has(toolName)) return policy.allowFileWrite;
  if (GIT_TOOL_NAMES.has(toolName)) return policy.allowGit;
  if (EXECUTION_TOOL_NAMES.has(toolName)) return policy.allowExecution;
  if (ANALYSIS_TOOL_NAMES.has(toolName)) return policy.allowAnalysis;
  return false;
}

export function getAllowedToolDefinitions(policy: ToolPolicy): ToolDefinitionLike[] {
  if (!policy.enabled) return [];
  return [...ALL_TOOL_DEFINITIONS, ...ANALYSIS_TOOL_DEFINITIONS]
    .filter((tool) => isToolAllowed(policy, tool.function.name));
}
