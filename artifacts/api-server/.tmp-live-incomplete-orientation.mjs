import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { chat, resolveTurnIntent } from "@workspace/ai-orchestrator";

const rootPath = await fs.mkdtemp(path.join(tmpdir(), "engineeringos-live-incomplete-orientation-"));
const files = {
  "README.md": "# EngineeringOS\nA source-backed engineering workspace.",
  "package.json": '{"name":"incomplete-orientation-fixture","private":true}',
};
const orientationSources = {
  purpose: ["README.md"],
  components: ["src/App.tsx"],
  primaryFlow: ["src/routes.ts"],
  uncertainty: ["tests/app.test.ts"],
};
const suppressed = new Map();
for (const method of [
  "assert", "clear", "count", "countReset", "debug", "dir", "error", "group",
  "groupCollapsed", "groupEnd", "info", "log", "table", "time", "timeEnd",
  "timeLog", "trace", "warn",
]) {
  if (typeof console[method] === "function") {
    suppressed.set(method, console[method]);
    console[method] = () => {};
  }
}

try {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootPath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
  const startedAt = Date.now();
  const result = await chat({
    provider: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    rootPath,
    history: [],
    message: "What is this project? Answer only from complete source reads.",
    turnIntent: resolveTurnIntent("What is this project?"),
    projectOrientation: true,
    orientationSourcesOverride: orientationSources,
    projectContext: {
      project: "EngineeringOS incomplete orientation fixture",
      workflows: "",
      recentTasks: "",
      latestMetrics: "",
      graphSummary: Object.keys(files).join(" "),
      recentEvents: "",
      metricsVerified: false,
    },
    signal: AbortSignal.timeout(75_000),
  });
  const coverage = result.sourceSelectionRecord?.orientationCoverage;
  const response = typeof result.response === "string" ? result.response : "";
  process.stdout.write(`${JSON.stringify({
    kind: "live-incomplete-project-orientation-receipt",
    provider: "openrouter",
    status: coverage?.complete === true ? "COMPLETE" : "INCOMPLETE",
    orientationComplete: coverage?.complete === true,
    missingRoles: Array.isArray(coverage?.missingRoles) ? coverage.missingRoles.length : null,
    sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
    hasIncompleteMarker: response.includes("ANALYSIS_INCOMPLETE"),
    parseError: result._parseError === true,
    responseLength: response.length,
    latencyMs: Date.now() - startedAt,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    kind: "live-incomplete-project-orientation-receipt",
    provider: "openrouter",
    status: "INCOMPLETE",
    failureKind: error?.name === "AbortError" ? "timeout" : "provider_or_runtime_failure",
  })}\n`);
  process.exitCode = 2;
} finally {
  await fs.rm(rootPath, { recursive: true, force: true });
  for (const [method, original] of suppressed) console[method] = original;
}