import { ANALYSIS_TOOL_DEFINITIONS } from "./tools/analysis-tools.js";
import { BINARY_TOOL_DEFINITIONS } from "./tools/binary-tools.js";
import { CODE_NAVIGATION_TOOL_DEFINITIONS } from "./tools/code-navigation.js";
import { EXECUTION_TOOL_DEFINITIONS } from "./tools/execution-tools.js";
import { FILE_TOOL_DEFINITIONS } from "./tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS } from "./tools/git-tools.js";
import { PACKAGE_TOOL_DEFINITIONS } from "./tools/package-tools.js";
import { MAX_ANALYSIS_TOOL_RESULT_BYTES } from "./tool-output-bounds.js";

export type ToolExecutorFamily =
  | "file"
  | "git"
  | "navigation"
  | "package"
  | "binary"
  | "execution"
  | "analysis";

export type ToolAuthorizationGroup =
  | "file_read"
  | "file_write"
  | "git_read"
  | "validation"
  | "execution"
  | "analysis";

export type ToolOutputBound =
  | {
      kind: "fixed_bytes";
      maxBytes: number;
      surface: "tool_body" | "serialized_result" | "process_buffer";
      notes?: string;
    }
  | {
      kind: "mode_dependent";
      surface: "tool_body";
      limits: readonly { mode: string; maxBytes: number }[];
      notes?: string;
    }
  | {
      kind: "profile_field";
      surface: "process_output";
      profileField: string;
      hardMaxBytes: number;
      notes?: string;
    }
  | {
      kind: "result_count";
      maxItems: number;
      maxItemChars?: number;
      notes: string;
    }
  | { kind: "dynamic"; basis: string }
  | { kind: "unspecified"; reason: string };

export type ToolTimeoutPolicy =
  | { kind: "none" }
  | { kind: "fixed_ms"; maxMs: number }
  | { kind: "profile_field_ms"; profileField: string; minMs: number; maxMs: number }
  | { kind: "runner_defined" }
  | { kind: "request_deadline"; source: string };

export type ToolOperationalMetadata = {
  executor: ToolExecutorFamily;
  authorizationGroup: ToolAuthorizationGroup;
  scope:
    | "project_path_read"
    | "project_root_read"
    | "git_repository_read"
    | "approved_write_path"
    | "approved_validation_profile"
    | "approved_execution_profile"
    | "correlated_analysis";
  missionPathScope: "exact_path" | "optional_path" | "generic_denied" | "not_applicable";
  outputBound: ToolOutputBound;
  cancellation: {
    signal: "cooperative" | "runner_delegated" | "unsupported";
    timeout: ToolTimeoutPolicy;
  };
  replay: {
    cache: "contextual_result" | "validation_attempt";
    durableRecovery: "safe_to_replay" | "block_after_prior_marker";
  };
};

const COOPERATIVE_NO_TIMEOUT: ToolOperationalMetadata["cancellation"] = {
  signal: "cooperative",
  timeout: { kind: "none" },
};
const CONTEXTUAL_READ_REPLAY: ToolOperationalMetadata["replay"] = {
  cache: "contextual_result",
  durableRecovery: "safe_to_replay",
};
const BLOCKED_ACTION_REPLAY: ToolOperationalMetadata["replay"] = {
  cache: "contextual_result",
  durableRecovery: "block_after_prior_marker",
};

/**
 * One server-owned operational record per provider-visible tool.
 *
 * `outputBound` describes the existing executor contract; it does not create a
 * runtime limit. `unspecified` is deliberate where a delegated runner or
 * executor currently has no enforceable output cap.
 */
export const TOOL_OPERATIONAL_METADATA = {
  read_file: {
    executor: "file",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "exact_path",
    outputBound: {
      kind: "mode_dependent",
      surface: "tool_body",
      limits: [
        { mode: "default", maxBytes: 128_000 },
        { mode: "complete", maxBytes: 512_000 },
      ],
      notes: "The truncation marker and surrounding tool protocol add bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  read_file_range: {
    executor: "file",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "exact_path",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 128_000,
      surface: "tool_body",
      notes: "Also limited to 4,000 output lines and a 512,000-byte scan budget.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  "project.list_tree": {
    executor: "file",
    authorizationGroup: "file_read",
    scope: "project_root_read",
    missionPathScope: "generic_denied",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 24_000,
      surface: "serialized_result",
      notes: "Also limited to depth 2 and 100 entries.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  list_directory: {
    executor: "file",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "generic_denied",
    outputBound: {
      kind: "dynamic",
      basis: "Directory listing is limited to 24,000 bytes/100 entries; file fallback uses the 128,000-byte read body limit; the dispatcher rejects serialized results over 512,000 bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  search_code: {
    executor: "file",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "generic_denied",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 24_000,
      surface: "tool_body",
      notes: "Also bounded by 50 lines, 100 files, per-file/total byte budgets, and a 10-second runtime.",
    },
    cancellation: {
      signal: "cooperative",
      timeout: { kind: "fixed_ms", maxMs: 10_000 },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
  write_file: {
    executor: "file",
    authorizationGroup: "file_write",
    scope: "approved_write_path",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 16_384,
      surface: "tool_body",
      notes: "The receipt contains bounded path/reason metadata, never proposed file contents; the dispatcher enforces this body limit.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: BLOCKED_ACTION_REPLAY,
  },
  replace_text: {
    executor: "file",
    authorizationGroup: "file_write",
    scope: "approved_write_path",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 16_384,
      surface: "tool_body",
      notes: "The receipt contains bounded path metadata, never proposed file contents; the dispatcher enforces this body limit.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: BLOCKED_ACTION_REPLAY,
  },
  git_status: {
    executor: "git",
    authorizationGroup: "git_read",
    scope: "git_repository_read",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 512 * 1024,
      surface: "process_buffer",
      notes: "execFile maxBuffer applies; the dispatcher separately rejects serialized results above its runtime cap.",
    },
    cancellation: {
      signal: "cooperative",
      timeout: { kind: "fixed_ms", maxMs: 10_000 },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
  git_diff: {
    executor: "git",
    authorizationGroup: "git_read",
    scope: "git_repository_read",
    missionPathScope: "optional_path",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 512 * 1024,
      surface: "process_buffer",
      notes: "execFile maxBuffer applies; the dispatcher separately rejects serialized results above its runtime cap.",
    },
    cancellation: {
      signal: "cooperative",
      timeout: { kind: "fixed_ms", maxMs: 10_000 },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
  git_log: {
    executor: "git",
    authorizationGroup: "git_read",
    scope: "git_repository_read",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: 512 * 1024,
      surface: "process_buffer",
      notes: "execFile maxBuffer applies; the command also limits history to 15 commits, and the dispatcher rejects oversized serialized results.",
    },
    cancellation: {
      signal: "cooperative",
      timeout: { kind: "fixed_ms", maxMs: 10_000 },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
  symbol_search: {
    executor: "navigation",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "optional_path",
    outputBound: {
      kind: "result_count",
      maxItems: 80,
      maxItemChars: 240,
      notes: "Scans at most 200 files and 512,000 bytes per file; the dispatcher rejects serialized results over 512,000 bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  ast_navigation: {
    executor: "navigation",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "optional_path",
    outputBound: {
      kind: "result_count",
      maxItems: 80,
      maxItemChars: 240,
      notes: "Scans at most 200 files and 512,000 bytes per file; the dispatcher rejects serialized results over 512,000 bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  inspect_dependencies: {
    executor: "package",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "dynamic",
      basis: "Manifest summaries vary by package count; lockfile previews are limited to 32,000 characters; the dispatcher rejects serialized results over 512,000 bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  inspect_binary: {
    executor: "binary",
    authorizationGroup: "file_read",
    scope: "project_path_read",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "dynamic",
      basis: "Reads a 1-MiB header and may hash a file up to 32 MiB; the dispatcher rejects serialized results over 512,000 bytes.",
    },
    cancellation: COOPERATIVE_NO_TIMEOUT,
    replay: CONTEXTUAL_READ_REPLAY,
  },
  run_validation: {
    executor: "execution",
    authorizationGroup: "validation",
    scope: "approved_validation_profile",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "unspecified",
      reason: "Registered profiles cap captured command output at 2,000,000 bytes and bound returned strings/counts; the dispatcher rejects serialized results over 1,000,000 bytes, but there is no single pre-serialization result byte cap.",
    },
    cancellation: {
      signal: "runner_delegated",
      timeout: { kind: "runner_defined" },
    },
    replay: {
      cache: "validation_attempt",
      durableRecovery: "block_after_prior_marker",
    },
  },
  run_browser_validation: {
    executor: "execution",
    authorizationGroup: "validation",
    scope: "approved_validation_profile",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "unspecified",
      reason: "Preview limits bound steps, summaries, console count/text, and screenshots; profile-derived evidence fields have no single pre-serialization byte cap, and the dispatcher rejects serialized results over 1,000,000 bytes.",
    },
    cancellation: {
      signal: "runner_delegated",
      timeout: { kind: "runner_defined" },
    },
    replay: BLOCKED_ACTION_REPLAY,
  },
  run_command: {
    executor: "execution",
    authorizationGroup: "execution",
    scope: "approved_execution_profile",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "profile_field",
      surface: "process_output",
      profileField: "CommandProfile.maxOutputBytes",
      hardMaxBytes: 8 * 1024 * 1024,
      notes: "The runner bounds combined process output; the dispatcher rejects serialized results above the 2,000,000-byte runtime ceiling.",
    },
    cancellation: {
      signal: "cooperative",
      timeout: {
        kind: "profile_field_ms",
        profileField: "CommandProfile.timeoutMs",
        minMs: 1,
        maxMs: 10 * 60 * 1000,
      },
    },
    replay: BLOCKED_ACTION_REPLAY,
  },
  refresh_project_scan: {
    executor: "analysis",
    authorizationGroup: "analysis",
    scope: "correlated_analysis",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: MAX_ANALYSIS_TOOL_RESULT_BYTES,
      surface: "serialized_result",
      notes: "The analysis producer caps output at 20,000 bytes, leaving room for safe untrusted-content framing.",
    },
    cancellation: {
      signal: "runner_delegated",
      timeout: { kind: "request_deadline", source: "analysisDeadlineAt is enforced by dispatch and passed to the runner; runner must honor abort to stop work" },
    },
    replay: BLOCKED_ACTION_REPLAY,
  },
  query_knowledge_graph: {
    executor: "analysis",
    authorizationGroup: "analysis",
    scope: "correlated_analysis",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: MAX_ANALYSIS_TOOL_RESULT_BYTES,
      surface: "serialized_result",
      notes: "The analysis producer caps output at 20,000 bytes, leaving room for safe untrusted-content framing.",
    },
    cancellation: {
      signal: "runner_delegated",
      timeout: { kind: "request_deadline", source: "analysisDeadlineAt is enforced by dispatch and passed to the runner; runner must honor abort to stop work" },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
  discover_project_apis: {
    executor: "analysis",
    authorizationGroup: "analysis",
    scope: "correlated_analysis",
    missionPathScope: "not_applicable",
    outputBound: {
      kind: "fixed_bytes",
      maxBytes: MAX_ANALYSIS_TOOL_RESULT_BYTES,
      surface: "serialized_result",
      notes: "The analysis producer caps output at 20,000 bytes, leaving room for safe untrusted-content framing.",
    },
    cancellation: {
      signal: "runner_delegated",
      timeout: { kind: "request_deadline", source: "analysisDeadlineAt is enforced by dispatch and passed to the runner; runner must honor abort to stop work" },
    },
    replay: CONTEXTUAL_READ_REPLAY,
  },
} as const satisfies Record<string, ToolOperationalMetadata>;

const ALL_TOOL_DEFINITIONS = [
  ...FILE_TOOL_DEFINITIONS,
  ...GIT_TOOL_DEFINITIONS,
  ...CODE_NAVIGATION_TOOL_DEFINITIONS,
  ...PACKAGE_TOOL_DEFINITIONS,
  ...BINARY_TOOL_DEFINITIONS,
  ...EXECUTION_TOOL_DEFINITIONS,
  ...ANALYSIS_TOOL_DEFINITIONS,
];

const DEFINITION_NAMES = ALL_TOOL_DEFINITIONS.map((tool) => tool.function.name);
const DEFINITION_NAME_SET = new Set(DEFINITION_NAMES);
const METADATA_NAMES = Object.keys(TOOL_OPERATIONAL_METADATA);

if (DEFINITION_NAMES.length !== DEFINITION_NAME_SET.size) {
  throw new Error("Tool operational registry found duplicate provider tool definitions.");
}
if (
  METADATA_NAMES.length !== DEFINITION_NAME_SET.size
  || METADATA_NAMES.some((name) => !DEFINITION_NAME_SET.has(name))
) {
  throw new Error("Tool operational registry must describe every provider tool definition exactly once.");
}

export function getToolOperationalMetadata(
  name: string,
): ToolOperationalMetadata | undefined {
  if (!Object.prototype.hasOwnProperty.call(TOOL_OPERATIONAL_METADATA, name)) {
    return undefined;
  }
  return TOOL_OPERATIONAL_METADATA[name as keyof typeof TOOL_OPERATIONAL_METADATA];
}

export function getToolNamesByExecutor(
  executor: ToolExecutorFamily,
): string[] {
  return Object.entries(TOOL_OPERATIONAL_METADATA)
    .filter(([, metadata]) => metadata.executor === executor)
    .map(([name]) => name);
}

export function getToolNamesByAuthorizationGroup(
  group: ToolAuthorizationGroup,
): string[] {
  return Object.entries(TOOL_OPERATIONAL_METADATA)
    .filter(([, metadata]) => metadata.authorizationGroup === group)
    .map(([name]) => name);
}

export function getDurableReplayBlockedToolNames(): string[] {
  return Object.entries(TOOL_OPERATIONAL_METADATA)
    .filter(([, metadata]) => metadata.replay.durableRecovery === "block_after_prior_marker")
    .map(([name]) => name);
}