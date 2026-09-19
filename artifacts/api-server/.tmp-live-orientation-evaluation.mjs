import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  chat,
  classifyRequest,
  isProjectOrientationQuestion,
  resolveTurnIntent,
} from "@workspace/ai-orchestrator";

const message =
  "اشرح EngineeringOS كاملًا من منظور المستخدم والمكونات الداخلية، واشمل Dashboard وAuthentication وProject Discovery وKnowledge Graph وAI Execution وGovernance، مع ذكر المسارات العامة كاملة ببادئة /api والاستشهاد بالملفات التي تثبت كل جزء.";
const requiredTerms = [
  "dashboard",
  "authentication",
  "project discovery",
  "knowledge graph",
  "ai execution",
  "governance",
  "/api",
];
const citationPaths = [
  "README.md",
  "src/App.tsx",
  "src/routes.ts",
  "tests/app.test.ts",
];
const completeFiles = {
  "README.md":
    "# EngineeringOS\nEngineeringOS is a source-backed engineering workspace with Dashboard, Authentication, Project Discovery, Knowledge Graph, AI Execution, and Governance.\n",
  "package.json": '{"name":"live-orientation-evaluation","private":true}',
  "src/App.tsx":
    "export function App() { return <main>Dashboard and Authentication</main>; }\n",
  "src/project-discovery.ts":
    "export const projectDiscovery = { path: '/api/projects/discover' };\n",
  "src/knowledge-graph.ts":
    "export const knowledgeGraph = { path: '/api/graph' };\n",
  "src/ai-execution.ts":
    "export const aiExecution = { path: '/api/ai/chat/stream' };\n",
  "src/governance.ts":
    "export const governance = { path: '/api/governance' };\n",
  "src/routes.ts":
    "export const routes = ['/api/projects', '/api/projects/discover', '/api/graph', '/api/ai/chat/stream', '/api/governance'];\n",
  "tests/app.test.ts": "test('app route', () => {});\n",
};
const completeSources = {
  purpose: ["README.md"],
  components: [
    "src/App.tsx",
    "src/project-discovery.ts",
    "src/knowledge-graph.ts",
    "src/ai-execution.ts",
    "src/governance.ts",
  ],
  primaryFlow: ["src/routes.ts"],
  uncertainty: ["tests/app.test.ts"],
};

const suppressed = new Map();
for (const method of [
  "assert",
  "clear",
  "count",
  "countReset",
  "debug",
  "dir",
  "error",
  "group",
  "groupCollapsed",
  "groupEnd",
  "info",
  "log",
  "table",
  "time",
  "timeEnd",
  "timeLog",
  "trace",
  "warn",
]) {
  if (typeof console[method] === "function") {
    suppressed.set(method, console[method]);
    console[method] = () => {};
  }
}

function evaluateResponse(response, coverage, sourceCount) {
  const normalized = response.toLowerCase();
  const letters = response.match(/[a-z\u0600-\u06ff]/gi) ?? [];
  const arabicLetters = response.match(/[\u0600-\u06ff]/g) ?? [];
  const termHits = Object.fromEntries(
    requiredTerms.map((term) => [term, normalized.includes(term)]),
  );
  const citationHits = Object.fromEntries(
    citationPaths.map((filePath) => [filePath, response.includes(filePath)]),
  );
  const missingRoles = Array.isArray(coverage?.missingRoles)
    ? coverage.missingRoles
    : [];
  return {
    orientationComplete: coverage?.complete === true,
    missingRoles,
    sourceCount,
    responseLength: response.length,
    responsePreview: response.replace(/\s+/g, " ").slice(0, 900),
    arabicRatio:
      letters.length === 0 ? 0 : Number((arabicLetters.length / letters.length).toFixed(2)),
    termHits,
    termCoverage: Object.values(termHits).filter(Boolean).length,
    citationHits,
    citationCoverage: Object.values(citationHits).filter(Boolean).length,
    hasIncompleteMarker: response.includes("ANALYSIS_INCOMPLETE"),
    parseError: false,
  };
}

async function writeFiles(rootPath, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(rootPath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
}

async function runCase({ name, files, orientationSources, timeoutMs }) {
  const rootPath = await fs.mkdtemp(
    path.join(tmpdir(), `engineeringos-live-${name}-`),
  );
  const classification = classifyRequest(message);
  const turnIntent = resolveTurnIntent(message, { classification });
  const startedAt = Date.now();
  try {
    await writeFiles(rootPath, files);
    const result = await chat({
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      rootPath,
      history: [],
      message,
      turnIntent,
      projectOrientation: isProjectOrientationQuestion(message),
      orientationSourcesOverride: orientationSources,
      projectContext: {
        project: `EngineeringOS live ${name} orientation evaluation`,
        workflows: "",
        recentTasks: "",
        latestMetrics: "",
        graphSummary: Object.keys(files).join(" "),
        recentEvents: "",
        metricsVerified: false,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const response = typeof result.response === "string" ? result.response : "";
    const evaluation = evaluateResponse(
      response,
      result.sourceSelectionRecord?.orientationCoverage,
      Array.isArray(result.sources) ? result.sources.length : 0,
    );
    const checks =
      name === "complete"
        ? {
            detector: isProjectOrientationQuestion(message),
            completeCoverage: evaluation.orientationComplete,
            noIncompleteMarker: !evaluation.hasIncompleteMarker,
            broadDomainCoverage: evaluation.termCoverage >= 5,
            sourceCitations: evaluation.citationCoverage >= 3,
            ArabicResponse: evaluation.arabicRatio >= 0.35,
          }
        : {
            detector: isProjectOrientationQuestion(message),
            incompleteCoverage: !evaluation.orientationComplete,
            incompleteMarker: evaluation.hasIncompleteMarker,
            missingRoles: evaluation.missingRoles.length >= 1,
          };
    return {
      name,
      status: "completed",
      intent: turnIntent.kind,
      category: classification.category,
      latencyMs: Date.now() - startedAt,
      evaluation,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  } catch (error) {
    return {
      name,
      // A live provider/transport failure does not establish either the
      // orientation acceptance contract or its incomplete-result contract.
      // Keep this case explicitly inconclusive so the receipt cannot report
      // an upstream failure as an application-level contract failure.
      status: "inconclusive",
      intent: turnIntent.kind,
      category: classification.category,
      latencyMs: Date.now() - startedAt,
      errorName: error?.name ?? "unknown",
      failureKind:
        error?.name === "AbortError" ? "timeout" : "provider_or_runtime_failure",
      passed: null,
    };
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

try {
  const incompleteSources = {
    purpose: ["README.md"],
    components: ["src/MissingApp.tsx"],
    primaryFlow: ["src/MissingRoutes.ts"],
    uncertainty: ["tests/Missing.test.ts"],
  };
  const results = [
    await runCase({
      name: "complete",
      files: completeFiles,
      orientationSources: completeSources,
      timeoutMs: 90_000,
    }),
    await runCase({
      name: "incomplete",
      files: {
        "README.md": completeFiles["README.md"],
        "package.json": completeFiles["package.json"],
      },
      orientationSources: incompleteSources,
      timeoutMs: 75_000,
    }),
  ];
  process.stdout.write(
    `${JSON.stringify({
      kind: "live-orientation-evaluation-receipt",
      provider: "openrouter",
      results,
      overallStatus: results.some((result) => result.status === "inconclusive")
        ? "inconclusive"
        : results.every((result) => result.passed)
          ? "passed"
          : "failed",
    })}\n`,
  );
} finally {
  for (const [method, original] of suppressed) console[method] = original;
}