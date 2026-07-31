/**
 * Tool policy and capability gating for ai-orchestrator.
 *
 * This layer decides whether a provider may receive any tools at all and
 * which tool definitions are exposed in a given execution mode.
 */
import { getProvider, type ProviderId } from "./provider-registry.js";
import { FILE_TOOL_DEFINITIONS, type ToolDefinition } from "./tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, type GitToolDefinition } from "./tools/git-tools.js";

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
  reason?: string;
};

const FILE_READ_TOOL_NAMES = new Set(["read_file", "list_directory", "search_code"]);
const FILE_WRITE_TOOL_NAMES = new Set(["write_file"]);
const GIT_TOOL_NAMES = new Set(["git_status", "git_diff", "git_log"]);

const ALL_TOOL_DEFINITIONS: ToolDefinitionLike[] = [...FILE_TOOL_DEFINITIONS, ...GIT_TOOL_DEFINITIONS];

export function resolveToolPolicy(opts: {
  provider: ProviderId;
  rootPath?: string;
  mode?: ToolMode;
}): ToolPolicy {
  const provider = getProvider(opts.provider);
  const mode = opts.mode ?? "workspace";

  if (!opts.rootPath) {
    return {
      provider: provider.providerId,
      rootPath: opts.rootPath,
      mode,
      enabled: false,
      allowFileRead: false,
      allowFileWrite: false,
      allowGit: false,
      reason: "tool policy requires a project root path",
    };
  }

  if (!provider.supportsTools) {
    return {
      provider: provider.providerId,
      rootPath: opts.rootPath,
      mode,
      enabled: false,
      allowFileRead: false,
      allowFileWrite: false,
      allowGit: false,
      reason: "provider registry marks this endpoint as text-only",
    };
  }

  return {
    provider: provider.providerId,
    rootPath: opts.rootPath,
    mode,
    enabled: true,
    allowFileRead: true,
    allowFileWrite: mode === "workspace",
    allowGit: true,
  };
}

export function isToolAllowed(policy: ToolPolicy, toolName: string): boolean {
  if (!policy.enabled) return false;
  if (FILE_READ_TOOL_NAMES.has(toolName)) return policy.allowFileRead;
  if (FILE_WRITE_TOOL_NAMES.has(toolName)) return policy.allowFileWrite;
  if (GIT_TOOL_NAMES.has(toolName)) return policy.allowGit;
  return false;
}

export function getAllowedToolDefinitions(policy: ToolPolicy): ToolDefinitionLike[] {
  if (!policy.enabled) return [];
  return ALL_TOOL_DEFINITIONS.filter((tool) => isToolAllowed(policy, tool.function.name));
}
