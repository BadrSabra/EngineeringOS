export type ToolSurfaceFamily =
  | "text_search"
  | "symbol_search"
  | "ast_navigation"
  | "terminal"
  | "validation"
  | "git"
  | "browser"
  | "package_management"
  | "database"
  | "object_storage"
  | "integration"
  | "external_api"
  | "deployment"
  | "logs"
  | "binary_read";

export type ToolSurfaceAvailability = "implemented" | "adapter_required";
export type ToolSurfaceMutation = "none" | "proposal" | "approval_gated";

export type ToolSurfaceEntry = {
  family: ToolSurfaceFamily;
  tools: readonly string[];
  availability: ToolSurfaceAvailability;
  serverAuthorized: true;
  traceable: true;
  resumable: true;
  revisionBound: true;
  verifiable: true;
  mutation: ToolSurfaceMutation;
  /** Adapter-required capabilities are intentionally not provider-facing tools. */
  exposedToModel: boolean;
};

const TOOL_SURFACE: readonly ToolSurfaceEntry[] = [
  {
    family: "text_search",
    tools: ["search_code"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "none",
    exposedToModel: true,
  },
  {
    family: "symbol_search",
    tools: ["symbol_search"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "none",
    exposedToModel: true,
  },
  {
    family: "ast_navigation",
    tools: ["ast_navigation"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "none",
    exposedToModel: true,
  },
  {
    family: "terminal",
    tools: ["run_command"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "approval_gated",
    exposedToModel: true,
  },
  {
    family: "validation",
    tools: ["run_validation"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "approval_gated",
    exposedToModel: true,
  },
  {
    family: "git",
    tools: ["git_status", "git_diff", "git_log"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "none",
    exposedToModel: true,
  },
  {
    family: "browser",
    tools: ["run_browser_validation"],
    availability: "implemented",
    serverAuthorized: true,
    traceable: true,
    resumable: true,
    revisionBound: true,
    verifiable: true,
    mutation: "approval_gated",
    exposedToModel: true,
  },
  ...([
    ["package_management", ["inspect_dependencies", "install_package", "update_dependency"]],
    ["database", ["inspect_database"]],
    ["object_storage", ["read_object", "write_object"]],
    ["integration", ["query_integration"]],
    ["external_api", ["call_external_api"]],
    ["deployment", ["inspect_deployment", "publish_deployment"]],
    ["logs", ["read_runtime_logs"]],
    ["binary_read", ["inspect_binary", "read_image", "read_pdf", "read_binary"]],
  ] as const).map(([family, tools]) => ({
    family,
    tools,
    availability: "adapter_required" as const,
    serverAuthorized: true as const,
    traceable: true as const,
    resumable: true as const,
    revisionBound: true as const,
    verifiable: true as const,
    mutation: (family === "package_management" || family === "object_storage" || family === "deployment"
      ? "approval_gated"
      : "none") as ToolSurfaceMutation,
    exposedToModel: false,
  })),
];

export function getToolSurfaceCatalog(): readonly ToolSurfaceEntry[] {
  return TOOL_SURFACE;
}

export function getToolSurfaceEntry(family: ToolSurfaceFamily): ToolSurfaceEntry {
  const entry = TOOL_SURFACE.find((candidate) => candidate.family === family);
  if (!entry) throw new Error(`Unknown tool surface family "${family}".`);
  return entry;
}

export function isToolSurfaceReady(family: ToolSurfaceFamily): boolean {
  return getToolSurfaceEntry(family).availability === "implemented";
}