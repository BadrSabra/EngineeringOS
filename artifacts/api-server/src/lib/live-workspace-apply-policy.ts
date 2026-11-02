/**
 * Live-root Apply is disabled until the server and the Replit editor share a
 * supported write coordinator or conditional-write primitive. PostgreSQL
 * advisory locks only serialize API callers; they cannot fence editor saves.
 *
 * The test exception is limited to Vitest's isolated temporary workspaces.
 * There is deliberately no development/production environment-variable switch
 * that can re-enable writes against a shared project root.
 */
export const LIVE_WORKSPACE_WRITE_UNCOORDINATED_CODE =
  "LIVE_WORKSPACE_WRITE_UNCOORDINATED";

export const LIVE_WORKSPACE_WRITE_UNCOORDINATED_MESSAGE =
  "Live Apply is paused because server writes cannot be coordinated atomically with the Replit editor. The proposal remains pending and this request did not modify project files.";

export const LIVE_WORKSPACE_COMMIT_UNCOORDINATED_MESSAGE =
  "AI proposal commits are paused until the candidate can be committed from an immutable source without staging the shared Replit workspace.";

export const APPLY_MISSION_CREATION_PAUSED_MESSAGE =
  "Creating a new Apply Mission is paused until a safe candidate delivery path exists. No Mission or Goal was created.";

export function isLiveWorkspaceWriteUncoordinated(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv !== "test";
}
