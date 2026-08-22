import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const journeyPath = resolve(root, "artifacts/dashboard/e2e/dashboard.journey.ts");
const runnerPath = resolve(root, "scripts/run-dashboard-journey.mjs");

const [journeySource, runnerSource] = await Promise.all([
  readFile(journeyPath, "utf8"),
  readFile(runnerPath, "utf8"),
]);

function constant(source, name) {
  const match = source.match(
    new RegExp(`const ${name} = ([0-9_]+);`),
  );
  assert.ok(match, `Expected ${name} to remain a numeric constant.`);
  return Number(match[1].replaceAll("_", ""));
}

function runnerDefaultTimeout(source) {
  const match = source.match(
    /DASHBOARD_E2E_LIVE_TIMEOUT_MS\s*\?\?\s*([0-9_]+)/,
  );
  assert.ok(match, "Expected the runner to define a live timeout default.");
  return Number(match[1].replaceAll("_", ""));
}

test("live journey timeout has Playwright headroom", () => {
  const providerTimeout = constant(journeySource, "DEFAULT_LIVE_TIMEOUT_MS");
  const testTimeoutMargin = constant(journeySource, "LIVE_TEST_TIMEOUT_MARGIN_MS");
  const runnerTimeout = runnerDefaultTimeout(runnerSource);

  assert.equal(
    runnerTimeout,
    providerTimeout,
    "The release runner and browser journey must use the same live timeout default.",
  );
  assert.ok(
    testTimeoutMargin > 0,
    "The live journey needs positive Playwright cleanup/reporting headroom.",
  );
  assert.match(
    journeySource,
    /test\.setTimeout\(liveTimeoutMs\(\) \+ LIVE_TEST_TIMEOUT_MARGIN_MS\)/,
    "The live test timeout must exceed its provider request/polling budget.",
  );
  assert.match(
    journeySource,
    /timeout: liveTimeoutMs\(\)/,
    "The live provider request must use the configured provider timeout.",
  );
});

test("the standard release journey remains provider-free", () => {
  assert.match(
    journeySource,
    /test\.skip\(\s*process\.env\.DASHBOARD_E2E_LIVE_PROVIDER !== "1"/,
    "The provider-backed browser test must remain opt-in.",
  );
  assert.match(
    runnerSource,
    /process\.env\.DASHBOARD_E2E_LIVE_PROVIDER === "1"/,
    "Live-only report validation must remain behind the opt-in flag.",
  );

  const browserEnvironment = runnerSource.match(
    /const child = spawn\([\s\S]*?env:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*stdio:/,
  );
  assert.ok(browserEnvironment, "Could not locate the browser journey environment.");
  assert.doesNotMatch(
    browserEnvironment[1],
    /DASHBOARD_E2E_LIVE_PROVIDER\s*:/,
    "The standard runner must not enable live provider execution.",
  );
});

test("runs the mission correlation report contract before browser startup", () => {
  assert.match(
    runnerSource,
    /await runMissionCorrelationReportContracts\(\)/,
    "The release runner must validate the report boundary before starting the browser journey.",
  );
  assert.match(
    runnerSource,
    /test:mission-correlation-report/,
    "The release runner must invoke the provider-free report contract test.",
  );
});

test("release teardown reports each service and any surviving listener", () => {
  assert.match(
    runnerSource,
    /Release service teardown results:/,
    "The release runner must report lifecycle results for every managed service.",
  );
  assert.match(
    runnerSource,
    /Release services surviving teardown: none\./,
    "The release runner must explicitly report a clean teardown.",
  );
  assert.match(
    runnerSource,
    /Release services surviving teardown:/,
    "The release runner must identify a service that remains on its release port.",
  );
  assert.match(
    runnerSource,
    /ensureReleasePortsFree\(\)/,
    "Residual listeners must still be cleaned up after being reported.",
  );
});

test("live recovery requires an evidence-backed success", () => {
  assert.match(
    journeySource,
    /DEFAULT_LIVE_PROMPT[\s\S]*accepted evidence item[\s\S]*validation checkpoint/,
    "The live journey must request an evidence-producing forensic mission by default.",
  );
  assert.match(
    journeySource,
    /successStates\.has\(terminalState\)[\s\S]*evidenceCount < 1[\s\S]*validation\.length < 1/,
    "A successful live terminal must not pass without evidence and validation.",
  );
  assert.match(
    runnerSource,
    /MISSION_CORRELATION_REQUIRE_EVIDENCE:\s*"1"/,
    "The live report validator must enforce evidence-backed success.",
  );
});
