export const LIFECYCLE_WORKER_SCOPE_PROJECT_HEADER =
  "x-engineeringos-lifecycle-worker-project-id";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A project-scoped worker is allowed only for the controlled, provider-fixture
 * lifecycle journey. Ordinary API workers have no scope and retain their
 * existing scheduling behavior.
 */
export function getLifecycleWorkerScopeProjectId(): string | undefined {
  const value = process.env.ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID?.trim();
  if (!value) return undefined;

  const fixtureMode =
    process.env.DASHBOARD_E2E_TEST_MODE === "fixture"
    && process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1"
    && (
      process.env.MISSION_E2E_PROVIDER_FIXTURE === "1"
      || process.env.DASHBOARD_E2E_PROVIDER_FIXTURE === "1"
      || process.env.AI_PROVIDER_EGRESS_DISABLED === "1"
    );
  if (
    !UUID_PATTERN.test(value)
    || process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1"
    || process.env.ENGINEERING_AGENT_LIFECYCLE_E2E !== "1"
    || process.env.NODE_ENV === "production"
    || !fixtureMode
  ) {
    throw new Error(
      "Project-scoped lifecycle workers require a controlled, provider-fixture release journey and a UUID project scope.",
    );
  }
  return value;
}

export function isProjectInLifecycleWorkerScope(projectId: string): boolean {
  const scopeProjectId = getLifecycleWorkerScopeProjectId();
  return !scopeProjectId || scopeProjectId === projectId;
}
