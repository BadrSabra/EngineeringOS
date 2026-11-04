const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MissionDecisionShadowScopeInput {
  enabled: boolean;
  configuredProjectId?: string;
  requestedProjectId?: string;
}

/**
 * Shadow mode is never global: it requires one server-configured project UUID.
 * Project-scoped scheduler calls for other projects are rejected.
 */
export function resolveMissionDecisionShadowProjectScope(
  input: MissionDecisionShadowScopeInput,
): string | null {
  if (!input.enabled) return null;
  const projectId = input.configuredProjectId?.trim();
  if (!projectId || !UUID_PATTERN.test(projectId)) return null;
  if (input.requestedProjectId !== undefined && input.requestedProjectId !== projectId) return null;
  return projectId;
}
