/**
 * Unit tests for the plugin hook implementations.
 *
 * These tests call each plugin's onScanComplete hook directly (via
 * PLUGIN_HOOKS) with controlled ScanCompleteContext fixtures. No DB or
 * supertest required — the hooks are pure async functions over data.
 */
import { describe, expect, it } from "vitest";
import {
  PLUGIN_HOOKS,
  type ScanCompleteContext,
  type ExtractedEntity,
} from "./plugin-runtime.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseCtx(overrides: Partial<ScanCompleteContext> = {}): ScanCompleteContext {
  return {
    projectId: "proj-test",
    language: "typescript",
    framework: null,
    filesFound: 10,
    sourceFiles: 8,
    issuesDetected: 0,
    tasksCreated: 0,
    entitiesExtracted: 5,
    relationshipsExtracted: 3,
    ruleViolations: [],
    entities: [],
    ...overrides,
  };
}

function entity(type: string, name: string, path?: string): ExtractedEntity {
  return { type, name, path };
}

// ─── plugin-react ──────────────────────────────────────────────────────────────

describe("plugin-react", () => {
  const hook = PLUGIN_HOOKS["plugin-react"]!;

  it("returns no events for a non-JS/TS project", async () => {
    const result = await hook.onScanComplete(baseCtx({ language: "python" }));
    expect(result.events ?? []).toHaveLength(0);
  });

  it("detects components and hooks and emits an info event", async () => {
    const ctx = baseCtx({
      entities: [
        entity("function", "useAuth"),
        entity("function", "useTheme"),
        entity("function", "UserCard"),
        entity("class", "AuthProvider"),
      ],
      relationshipsExtracted: 2,
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    const analysis = events.find((e) => e.type === "ReactPluginAnalysis");
    expect(analysis).toBeDefined();
    expect(analysis!.severity).toBe("info");
    expect(analysis!.message).toMatch(/2 component/);
    expect(analysis!.message).toMatch(/2 custom hook/);
  });

  it("emits a coupling advisory when components exist but no relationships", async () => {
    const ctx = baseCtx({
      entities: [entity("function", "Dashboard"), entity("function", "Sidebar")],
      relationshipsExtracted: 0,
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const advisory = events.find((e) => e.type === "ReactPluginAdvisory");
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe("warning");
  });

  it("does not emit advisory when relationships exist", async () => {
    const ctx = baseCtx({
      entities: [entity("function", "Dashboard")],
      relationshipsExtracted: 4,
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    expect(events.find((e) => e.type === "ReactPluginAdvisory")).toBeUndefined();
  });

  it("returns empty events for JS project with no components or hooks", async () => {
    const ctx = baseCtx({
      language: "javascript",
      entities: [entity("file", "utils.js"), entity("function", "formatDate")],
    });
    const result = await hook.onScanComplete(ctx);
    // formatDate is not PascalCase and doesn't start with "use" — no event
    const events = result.events ?? [];
    expect(events.find((e) => e.type === "ReactPluginAnalysis")).toBeUndefined();
  });
});

// ─── plugin-node ──────────────────────────────────────────────────────────────

describe("plugin-node", () => {
  const hook = PLUGIN_HOOKS["plugin-node"]!;

  it("returns no events for a non-JS/TS project", async () => {
    const result = await hook.onScanComplete(baseCtx({ language: "python" }));
    expect(result.events ?? []).toHaveLength(0);
  });

  it("emits an info event when API entities are detected", async () => {
    const ctx = baseCtx({
      entities: [
        entity("api", "GET /users"),
        entity("api", "POST /orders"),
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const info = events.find((e) => e.type === "NodePluginAnalysis");
    expect(info).toBeDefined();
    expect(info!.message).toMatch(/2 API route/);
  });

  it("emits advisory for security-sensitive route names", async () => {
    const ctx = baseCtx({
      entities: [
        entity("api", "DELETE /admin/users"),
        entity("api", "GET /internal/metrics"),
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const advisory = events.find((e) => e.type === "NodePluginAdvisory");
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe("warning");
  });

  it("returns empty events when no API entities exist", async () => {
    const ctx = baseCtx({ entities: [entity("function", "handleRequest")] });
    const result = await hook.onScanComplete(ctx);
    expect(result.events ?? []).toHaveLength(0);
  });
});

// ─── plugin-security ──────────────────────────────────────────────────────────

describe("plugin-security", () => {
  const hook = PLUGIN_HOOKS["plugin-security"]!;

  it("emits an error event when critical/high violations exist", async () => {
    const ctx = baseCtx({
      issuesDetected: 5,
      ruleViolations: [
        { ruleId: "r1", code: "SEC-001", severity: "critical", matchCount: 3 },
        { ruleId: "r2", code: "SEC-002", severity: "high", matchCount: 2 },
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const alert = events.find((e) => e.type === "SecurityPluginAlert");
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe("error");
    expect(alert!.message).toMatch(/2 critical\/high rule/);
    expect((alert!.payload as any).totalMatches).toBe(5);
  });

  it("emits a success event when no issues detected and source files exist", async () => {
    const ctx = baseCtx({ issuesDetected: 0, sourceFiles: 10 });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const clear = events.find((e) => e.type === "SecurityPluginClear");
    expect(clear).toBeDefined();
    expect(clear!.severity).toBe("success");
  });

  it("ignores medium/low violations (no alert)", async () => {
    const ctx = baseCtx({
      issuesDetected: 2,
      ruleViolations: [
        { ruleId: "r1", code: "LINT-001", severity: "medium", matchCount: 2 },
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    expect(events.find((e) => e.type === "SecurityPluginAlert")).toBeUndefined();
  });
});

// ─── plugin-performance ───────────────────────────────────────────────────────

describe("plugin-performance", () => {
  const hook = PLUGIN_HOOKS["plugin-performance"]!;

  it("returns no events when no entities extracted", async () => {
    const result = await hook.onScanComplete(
      baseCtx({ entitiesExtracted: 0, relationshipsExtracted: 0 }),
    );
    expect(result.events ?? []).toHaveLength(0);
  });

  it("emits advisory for high avg degree (> 8)", async () => {
    // avgDegree = (relationships * 2) / entities = (50 * 2) / 10 = 10
    const ctx = baseCtx({ entitiesExtracted: 10, relationshipsExtracted: 50 });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const advisory = events.find((e) => e.type === "PerfPluginAdvisory");
    expect(advisory).toBeDefined();
    expect(advisory!.severity).toBe("warning");
  });

  it("emits info event for normal coupling", async () => {
    // avgDegree = (6 * 2) / 10 = 1.2
    const ctx = baseCtx({ entitiesExtracted: 10, relationshipsExtracted: 6 });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const info = events.find((e) => e.type === "PerfPluginAnalysis");
    expect(info).toBeDefined();
    expect(info!.severity).toBe("info");
  });
});

// ─── plugin-python ────────────────────────────────────────────────────────────

describe("plugin-python", () => {
  const hook = PLUGIN_HOOKS["plugin-python"]!;

  it("returns no events for non-Python projects", async () => {
    const result = await hook.onScanComplete(baseCtx({ language: "typescript" }));
    expect(result.events ?? []).toHaveLength(0);
  });

  it("emits analysis event for Python project with classes and functions", async () => {
    const ctx = baseCtx({
      language: "python",
      entities: [
        entity("class", "UserModel", "app/models.py"),
        entity("function", "get_user", "app/api.py"),
        entity("function", "create_user", "app/api.py"),
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const analysis = events.find((e) => e.type === "PythonPluginAnalysis");
    expect(analysis).toBeDefined();
    expect(analysis!.message).toMatch(/1 class/);
    expect(analysis!.message).toMatch(/2 function/);
  });
});

// ─── plugin-docs ──────────────────────────────────────────────────────────────

describe("plugin-docs", () => {
  const hook = PLUGIN_HOOKS["plugin-docs"]!;

  it("returns no events when no documentable entities exist", async () => {
    const ctx = baseCtx({
      entities: [entity("file", "utils.ts"), entity("module", "utils")],
    });
    const result = await hook.onScanComplete(ctx);
    expect(result.events ?? []).toHaveLength(0);
  });

  it("emits analysis event for documentable entities", async () => {
    const ctx = baseCtx({
      sourceFiles: 10,
      entities: [
        entity("function", "authenticate"),
        entity("class", "UserService"),
        entity("api", "POST /login"),
      ],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const analysis = events.find((e) => e.type === "DocsPluginAnalysis");
    expect(analysis).toBeDefined();
    expect(analysis!.message).toMatch(/3 documentable/);
  });

  it("severity is warning when entity density < 0.5 per source file", async () => {
    // 2 entities / 20 source files = 0.1 < 0.5
    const ctx = baseCtx({
      sourceFiles: 20,
      entities: [entity("function", "fn1"), entity("class", "Cls1")],
    });
    const result = await hook.onScanComplete(ctx);
    const events = result.events ?? [];
    const analysis = events.find((e) => e.type === "DocsPluginAnalysis");
    expect(analysis?.severity).toBe("warning");
  });
});
