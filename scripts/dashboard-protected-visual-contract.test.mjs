import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runnerSource = await readFile(
  resolve(root, "scripts/run-dashboard-protected-visual.mjs"),
  "utf8",
);
const journeySource = await readFile(
  resolve(root, "artifacts/dashboard/e2e/dashboard.journey.ts"),
  "utf8",
);
const viteSource = await readFile(
  resolve(root, "artifacts/dashboard/vite.config.ts"),
  "utf8",
);
const uxwWorkflowSource = await readFile(
  resolve(root, ".github/workflows/uxw01-browser-isolated.yml"),
  "utf8",
);
const uxwDockerfileSource = await readFile(
  resolve(root, ".github/uxw01-browser.Dockerfile"),
  "utf8",
);
const uxwContainerScriptSource = await readFile(
  resolve(root, "scripts/run-uxw01-browser-container.sh"),
  "utf8",
);
const playwrightConfigSource = await readFile(
  resolve(root, "artifacts/dashboard/e2e/playwright.config.ts"),
  "utf8",
);

test("the protected visual runner gates every service on loopback isolation", () => {
  const isolationGate = runnerSource.indexOf(
    "isolationEvidence = await verifyLoopbackIsolation()",
  );
  const postgresStart = runnerSource.indexOf('"initdb",');
  const dashboardStart = runnerSource.indexOf(
    'stage = "dashboard-service"',
  );
  const postgresConfirmation = runnerSource.indexOf(
    "databaseCheck.stdout.trim()",
  );
  assert.ok(isolationGate >= 0 && isolationGate < postgresStart);
  assert.ok(isolationGate < dashboardStart);
  assert.ok(postgresConfirmation > postgresStart);
  assert.ok(postgresConfirmation < dashboardStart);
  assert.match(
    runnerSource,
    /inspectLoopbackOnlyNetworkSnapshot\(snapshot\)[\s\S]*?if \(!isolation\.ok\)[\s\S]*?throw new Error/u,
  );
  assert.match(
    runnerSource,
    /await writePreflightReceipt\("blocked", reason,[\s\S]*?networkNamespace/u,
  );
  assert.match(runnerSource, /servicesStarted: false/u);
});

test("the visual runner isolates credentials, API traffic, and screenshots", () => {
  assert.match(
    runnerSource,
    /key\.startsWith\("CLERK_"\)[\s\S]*?key === "VITE_CLERK_PUBLISHABLE_KEY"[\s\S]*?key === "API_PROXY_TARGET"/u,
  );
  assert.match(runnerSource, /key\.toLowerCase\(\) === "github"/u);
  assert.match(runnerSource, /browser-journey\.log/u);
  assert.match(
    runnerSource,
    /apiServiceStarted: false[\s\S]*?apiProxyConfigured: false/u,
  );
  assert.match(
    runnerSource,
    /browserAudit\.blockedRequestCount !== 0[\s\S]*?visualReport\?\.captures\?\.length !== 32/u,
  );
  assert.match(
    viteSource,
    /process\.env\.HOST === '127\.0\.0\.1'[\s\S]*?!process\.env\.API_PROXY_TARGET[\s\S]*?!process\.env\.CLERK_SECRET_KEY/u,
  );
  assert.match(
    viteSource,
    /protected-visual-disable-remote-fonts/u,
  );
});

test("UXW-01 skips PostgreSQL only for its API-fixtured focused journey", () => {
  assert.match(runnerSource, /testGrep === "UXW-01"/u);
  assert.match(
    runnerSource,
    /requiresTemporaryPostgres &&[\s\S]*?commandExists\(command\)/u,
  );
  assert.match(
    runnerSource,
    /if \(requiresTemporaryPostgres\) \{[\s\S]*?runCommand\([\s\S]*?"initdb"/u,
  );
  assert.match(
    runnerSource,
    /disposablePostgres: requiresTemporaryPostgres[\s\S]*?notRequired: true[\s\S]*?UXW-01 browser fixtures intercept all API requests/u,
  );
});

test("the UXW-01 GitHub job requires approval and keeps runtime network-isolated", () => {
  assert.match(uxwWorkflowSource, /workflow_dispatch:/u);
  assert.match(
    uxwWorkflowSource,
    /confirm_uxw01_browser:[\s\S]*?default: false/u,
  );
  assert.match(
    uxwWorkflowSource,
    /allow_dependency_bootstrap_egress:[\s\S]*?default: false/u,
  );
  assert.match(
    uxwWorkflowSource,
    /inputs\.confirm_uxw01_browser && inputs\.allow_dependency_bootstrap_egress && github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(uxwWorkflowSource, /--network none/u);
  assert.match(uxwWorkflowSource, /--cap-drop ALL/u);
  assert.match(uxwWorkflowSource, /--security-opt no-new-privileges:true/u);
  assert.match(
    uxwWorkflowSource,
    /const routesAreLoopback = \[\.\.\.ipv4Routes, \.\.\.ipv6Routes\]\s+\.every\(\(route\) => route\.iface === "lo"\);/u,
  );
  assert.match(
    uxwWorkflowSource,
    /--user "\$\{smoke_uid\}:\$\{smoke_gid\}"/u,
  );
  assert.match(uxwWorkflowSource, /persist-credentials: false/u);
  assert.doesNotMatch(
    uxwWorkflowSource,
    /secrets\.|CLERK_SECRET_KEY|OPENROUTER_API_KEY/u,
  );
  assert.match(
    uxwDockerfileSource,
    /mcr\.microsoft\.com\/playwright:v1\.62\.1-noble/u,
  );
  assert.match(
    uxwDockerfileSource,
    /pnpm install --frozen-lockfile --filter @workspace\/dashboard\.\.\./u,
  );
  assert.match(uxwContainerScriptSource, /DASHBOARD_E2E_GREP=UXW-01/u);
  assert.match(
    uxwContainerScriptSource,
    /validate:dashboard-protected-visual/u,
  );
  assert.doesNotMatch(
    uxwContainerScriptSource,
    /CLERK_SECRET_KEY|OPENROUTER_API_KEY|SESSION_SECRET/u,
  );
});

test("the protected visual journey is read-only and records its layout evidence", () => {
  assert.match(
    journeySource,
    /captures protected dashboard routes at phone, tablet, and desktop sizes/u,
  );
  assert.match(
    journeySource,
    /test\.skip\([\s\S]*?DASHBOARD_E2E_PROTECTED_VISUAL !== "1"/u,
  );
  assert.match(
    journeySource,
    /overrides\.protectedVisual\.apiRequests\.push/u,
  );
  assert.match(
    journeySource,
    /mutativeRequests[\s\S]*?must not issue mutating API requests/u,
  );
  assert.match(journeySource, /width: 402, height: 874/u);
  assert.match(journeySource, /width: 768, height: \d+/u);
  assert.match(journeySource, /width: 1024, height: \d+/u);
  assert.match(journeySource, /width: 1440, height: 1000/u);
  assert.match(
    journeySource,
    /shellDirection[\s\S]*?mainDirection[\s\S]*?horizontalOverflow[\s\S]*?controlsOutsideContent/u,
  );
  assert.match(
    journeySource,
    /pageErrors,[\s\S]*?consoleErrors,[\s\S]*?failedRequests/u,
  );
});

test("Playwright failure artifacts use the mounted evidence directory", () => {
  assert.match(
    playwrightConfigSource,
    /testDir:[\s\S]*?outputDir:\s*process\.env\.PLAYWRIGHT_OUTPUT_DIR[\s\S]*?reporter:[\s\S]*?use:\s*\{/u,
  );
  assert.doesNotMatch(
    playwrightConfigSource,
    /use:\s*\{[\s\S]*?outputDir:/u,
  );
});
