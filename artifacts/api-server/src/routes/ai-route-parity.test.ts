/**
 * PR-06 — Route parity enforcement
 *
 * Ensures that every route registered in routes/ai.ts is documented in the
 * OpenAPI spec, and every AI-tagged path in the spec is implemented in code.
 *
 * Run as part of CI (`pnpm test`) to catch drift at merge time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../../");

// ── Extract routes from ai.ts source ─────────────────────────────────────────

function extractCodeRoutes(): Set<string> {
  const src = readFileSync(resolve(__dirname, "ai.ts"), "utf-8");
  const routes = new Set<string>();
  // Match: router.METHOD("/ai/path", ...)
  const re = /router\.(get|post|put|patch|delete)\("(\/ai\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    // Normalise Express param syntax (:id → {id}) for comparison with OpenAPI
    const path = "/api" + m[2].replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
    routes.add(`${method} ${path}`);
  }
  return routes;
}

// ── Extract paths from openapi.yaml ──────────────────────────────────────────

function extractSpecRoutes(): Set<string> {
  const yaml = readFileSync(resolve(ROOT, "lib/api-spec/openapi.yaml"), "utf-8");
  const routes = new Set<string>();

  // Walk through paths and their HTTP methods.
  // We parse by hand (no yaml parser dep) using line-level patterns which is
  // sufficient for the well-structured spec this project uses.
  const lines = yaml.split("\n");
  let currentPath: string | null = null;
  let captureNext = false;
  let inAiPath = false;
  let currentTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Top-level path entry: "  /api/something:"
    const pathMatch = line.match(/^  (\/api\/[^:]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      inAiPath = currentPath.startsWith("/api/ai/");
      currentTags = [];
      captureNext = false;
      continue;
    }

    if (!inAiPath || !currentPath) continue;

    // HTTP method entry: "    get:" / "    post:" etc.
    const methodMatch = line.match(/^    (get|post|put|patch|delete):$/);
    if (methodMatch) {
      captureNext = true;
      currentTags = [];
      // Look ahead for tags to exclude Git-only entries
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const tagsMatch = lines[j].match(/^\s+tags:\s*\[(.+)\]/);
        if (tagsMatch) {
          currentTags = tagsMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, ""));
          break;
        }
        // Stop looking if we hit another method or path
        if (lines[j].match(/^    (get|post|put|patch|delete):$/) || lines[j].match(/^  \/api\//)) break;
      }

      // Only include AI-tagged routes (exclude git-only routes mounted under /api/ai/)
      const isGitOnly = currentTags.length > 0 && !currentTags.includes("AI") && currentTags.includes("Git");
      if (!isGitOnly) {
        routes.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
      }
      continue;
    }
  }

  return routes;
}

// ── Parity test ───────────────────────────────────────────────────────────────

describe("AI route / OpenAPI spec parity (PR-06)", () => {
  const codeRoutes = extractCodeRoutes();
  const specRoutes = extractSpecRoutes();

  // Some routes intentionally absent from the spec (streaming endpoint uses
  // text/event-stream content-type which is harder to describe in OpenAPI 3.0
  // and is documented in code comments instead).
  const SPEC_EXEMPTIONS = new Set(["POST /api/ai/chat/stream"]);

  it("has no code-only AI routes missing from the OpenAPI spec", () => {
    const missing: string[] = [];
    for (const route of codeRoutes) {
      if (!specRoutes.has(route) && !SPEC_EXEMPTIONS.has(route)) {
        missing.push(route);
      }
    }
    expect(missing, `Routes in code but not in spec:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("has no spec-only AI paths not implemented in code", () => {
    const missing: string[] = [];
    for (const route of specRoutes) {
      if (!codeRoutes.has(route)) {
        missing.push(route);
      }
    }
    expect(missing, `Spec paths not implemented in code:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("spec covers at least the known baseline AI routes", () => {
    const baseline = [
      "GET /api/ai/groq-key",
      "PUT /api/ai/groq-key",
      "DELETE /api/ai/groq-key",
      "GET /api/ai/deepseek-key",
      "PUT /api/ai/deepseek-key",
      "DELETE /api/ai/deepseek-key",
      "GET /api/ai/active-provider",
      "POST /api/ai/chat",
      "POST /api/ai/tasks/{taskId}/execute",
      "POST /api/ai/workflows/{workflowId}/orchestrate",
    ];
    const uncovered = baseline.filter((r) => !specRoutes.has(r));
    expect(uncovered, `Baseline routes missing from spec:\n  ${uncovered.join("\n  ")}`).toEqual([]);
  });
});
