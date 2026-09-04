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
import type { AuthorizedToolManifestEntry } from "./context-contract.js";

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

export type ToolAuthorization = {
  allowed: boolean;
  reason:
    | "allowed"
    | "unknown_tool"
    | "tool_not_in_manifest"
    | "approval_manifest_missing"
    | "path_outside_approved_scope"
    | "validation_profile_not_approved"
    | "approval_required";
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

/** Full manifest is server-owned and is never derived from model output. */
export function getFullAuthorizedToolManifest(): AuthorizedToolManifestEntry[] {
  return [
    ...ALL_TOOL_DEFINITIONS,
    ...ANALYSIS_TOOL_DEFINITIONS,
  ].map((tool) => {
    const name = tool.function.name;
    const category: AuthorizedToolManifestEntry["category"] =
      FILE_READ_TOOL_NAMES.has(name) ? "file_read"
        : FILE_WRITE_TOOL_NAMES.has(name) ? "file_write"
          : GIT_TOOL_NAMES.has(name) ? "git_read"
            : ANALYSIS_TOOL_NAMES.has(name) ? "analysis"
              : name === "run_validation" || name === "run_browser_validation" ? "validation"
                : "execution";
    return {
      name,
      category,
      authorization: "server_owned" as const,
      approvalRequired: category === "file_write" || category === "validation" || category === "execution",
    };
  });
}

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

/**
 * Server-side post-model-turn authorization. Prompt text and repository data
 * are never inputs to this decision. An absent manifest is fail-closed.
 */
export function authorizeToolInvocation(opts: {
  toolName: string;
  args?: Record<string, unknown>;
  allowedTools?: ReadonlySet<string>;
  approvedFilePaths?: readonly string[];
  approvedValidationProfiles?: readonly string[];
  approvalState?: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
}): ToolAuthorization {
  const known = new Set([...FILE_READ_TOOL_NAMES, ...FILE_WRITE_TOOL_NAMES, ...GIT_TOOL_NAMES, ...EXECUTION_TOOL_NAMES, ...ANALYSIS_TOOL_NAMES]);
  if (!known.has(opts.toolName)) return { allowed: false, reason: "unknown_tool" };
  if (opts.allowedTools && !opts.allowedTools.has(opts.toolName)) {
    return { allowed: false, reason: "tool_not_in_manifest" };
  }
  const isWrite = FILE_WRITE_TOOL_NAMES.has(opts.toolName);
  const isValidationOrExecution =
    opts.toolName === "run_validation"
    || opts.toolName === "run_browser_validation"
    || opts.toolName === "run_command";
  if ((isWrite || isValidationOrExecution) && opts.approvalState !== "APPROVED") {
    return { allowed: false, reason: "approval_required" };
  }
  if (isWrite && opts.approvedFilePaths === undefined) {
    return { allowed: false, reason: "approval_manifest_missing" };
  }
  if (isValidationOrExecution && opts.approvedValidationProfiles === undefined) {
    return { allowed: false, reason: "approval_manifest_missing" };
  }
  const approvedFilePaths = opts.approvedFilePaths;
  const approvedValidationProfiles = opts.approvedValidationProfiles;
  const requestedPath = typeof opts.args?.path === "string"
    ? opts.args.path.replaceAll("\\", "/").replace(/^(\.\/)+/, "")
    : undefined;
  if (isWrite && (
    !requestedPath || !approvedFilePaths!.includes(requestedPath)
  )) {
    return { allowed: false, reason: "path_outside_approved_scope" };
  }
  if (isValidationOrExecution &&
      !approvedValidationProfiles!.includes(String(opts.args?.profile ?? "").trim())) {
    return { allowed: false, reason: "validation_profile_not_approved" };
  }
  return { allowed: true, reason: "allowed" };
}
