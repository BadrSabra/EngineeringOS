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

test("the protected visual runner gates every service on loopback isolation", () => {
  const isolationGate = runnerSource.indexOf(
    "isolationEvidence = await verifyLoopbackIsolation()",
  );
  const postgresStart = runnerSource.indexOf('runCommand(\n      "initdb"');
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
