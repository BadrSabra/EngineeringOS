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
import { CODE_NAVIGATION_TOOL_DEFINITIONS } from "./tools/code-navigation.js";
import { PACKAGE_TOOL_DEFINITIONS } from "./tools/package-tools.js";
import { BINARY_TOOL_DEFINITIONS } from "./tools/binary-tools.js";
import type { AuthorizedToolManifestEntry } from "./context-contract.js";
import {
  getToolOperationalMetadata,
  TOOL_OPERATIONAL_METADATA,
} from "./tool-operational-registry.js";

export type ToolMode = "workspace" | "read-only" | "project-read-only";

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

const ALL_TOOL_DEFINITIONS: ToolDefinitionLike[] = [
  ...FILE_TOOL_DEFINITIONS,
  ...GIT_TOOL_DEFINITIONS,
  ...EXECUTION_TOOL_DEFINITIONS,
  ...CODE_NAVIGATION_TOOL_DEFINITIONS,
  ...PACKAGE_TOOL_DEFINITIONS,
  ...BINARY_TOOL_DEFINITIONS,
];

/** Full manifest is server-owned and is never derived from model output. */
export function getFullAuthorizedToolManifest(): AuthorizedToolManifestEntry[] {
  return [
    ...ALL_TOOL_DEFINITIONS,
    ...ANALYSIS_TOOL_DEFINITIONS,
  ].map((tool) => {
    const name = tool.function.name;
    const metadata = getToolOperationalMetadata(name);
    if (!metadata) {
      throw new Error(`Tool "${name}" is missing server-owned operational metadata.`);
    }
    const category: AuthorizedToolManifestEntry["category"] = metadata.authorizationGroup;
    return {
      name,
      category,
      authorization: "server_owned" as const,
      approvalRequired:
        metadata.authorizationGroup === "file_write"
        || metadata.authorizationGroup === "validation"
        || metadata.authorizationGroup === "execution",
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
      allowGit: mode !== "project-read-only",
      allowExecution,
      allowAnalysis: opts.allowAnalysis === true && mode !== "project-read-only",
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
  const group = getToolOperationalMetadata(toolName)?.authorizationGroup;
  switch (group) {
    case "file_read": return policy.allowFileRead;
    case "file_write": return policy.allowFileWrite;
    case "git_read": return policy.allowGit;
    case "validation":
    case "execution": return policy.allowExecution;
    case "analysis": return policy.allowAnalysis;
    default: return false;
  }
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
  /** Compound writes are proposals; they remain pending approval and never apply bytes. */
  compoundWriteMode?: boolean;
}): ToolAuthorization {
  const metadata = getToolOperationalMetadata(opts.toolName);
  if (!metadata || !Object.hasOwn(TOOL_OPERATIONAL_METADATA, opts.toolName)) {
    return { allowed: false, reason: "unknown_tool" };
  }
  if (opts.toolName === "project.list_tree" && !opts.allowedTools?.has(opts.toolName)) {
    return { allowed: false, reason: "tool_not_in_manifest" };
  }
  if (opts.allowedTools && !opts.allowedTools.has(opts.toolName)) {
    return { allowed: false, reason: "tool_not_in_manifest" };
  }
  const isWrite = metadata.authorizationGroup === "file_write";
  const isValidationOrExecution =
    metadata.authorizationGroup === "validation"
    || metadata.authorizationGroup === "execution";
  if (
    (isWrite || isValidationOrExecution) &&
    opts.approvalState !== "APPROVED" &&
    !(isWrite && opts.compoundWriteMode && opts.approvalState === "PENDING_APPROVAL")
  ) {
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
