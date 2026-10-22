import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLifecycleWorkerScopeProjectId,
  isProjectInLifecycleWorkerScope,
} from "./worker-scope.js";

const assignedProjectId = "4c34fc65-a4bf-4d53-8ad3-f2ad80b6ad85";
const otherProjectId = "bf1f890b-43f8-47bb-8e31-7f2f2420fc34";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lifecycle worker project scope", () => {
  it("leaves ordinary API workers unscoped", () => {
    vi.stubEnv("ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID", "");

    expect(getLifecycleWorkerScopeProjectId()).toBeUndefined();
    expect(isProjectInLifecycleWorkerScope(otherProjectId)).toBe(true);
  });

  it("rejects a scope outside controlled provider-fixture validation", () => {
    vi.stubEnv("ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID", assignedProjectId);
    vi.stubEnv("RUN_CONTROLLED_RELEASE_VALIDATION", "0");
    vi.stubEnv("ENGINEERING_AGENT_LIFECYCLE_E2E", "1");
    vi.stubEnv("DASHBOARD_E2E_TEST_MODE", "fixture");
    vi.stubEnv("DASHBOARD_E2E_PROVIDER_FIXTURE", "1");
    vi.stubEnv("NODE_ENV", "test");

    expect(() => getLifecycleWorkerScopeProjectId()).toThrow(
      /controlled, provider-fixture release journey/,
    );
  });

  it("allows only the explicitly assigned project in a controlled fixture run", () => {
    vi.stubEnv("ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID", assignedProjectId);
    vi.stubEnv("RUN_CONTROLLED_RELEASE_VALIDATION", "1");
    vi.stubEnv("ENGINEERING_AGENT_LIFECYCLE_E2E", "1");
    vi.stubEnv("DASHBOARD_E2E_TEST_MODE", "fixture");
    vi.stubEnv("DASHBOARD_E2E_PROVIDER_FIXTURE", "1");
    vi.stubEnv("NODE_ENV", "test");

    expect(getLifecycleWorkerScopeProjectId()).toBe(assignedProjectId);
    expect(isProjectInLifecycleWorkerScope(assignedProjectId)).toBe(true);
    expect(isProjectInLifecycleWorkerScope(otherProjectId)).toBe(false);
  });
});
