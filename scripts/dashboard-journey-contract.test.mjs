import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const journeyPath = resolve(
  root,
  "artifacts/dashboard/e2e/dashboard.journey.ts",
);
const runnerPath = resolve(root, "scripts/run-dashboard-journey.mjs");
const workflowPath = resolve(root, ".github/workflows/ci.yml");

const [journeySource, runnerSource, workflowSource] = await Promise.all([
  readFile(journeyPath, "utf8"),
  readFile(runnerPath, "utf8"),
  readFile(workflowPath, "utf8"),
]);

function constant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+);`));
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

async function startApiCorsHarness() {
  const port = 30_000 + Math.floor(Math.random() * 1_000);
  const harnessSource = `
    import app from "./artifacts/api-server/src/app.ts";
    const server = app.listen(Number(process.env.PORT), "127.0.0.1");
    process.once("SIGTERM", () => server.close(() => process.exit(0)));
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx/esm", "--eval", harnessSource],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        APP_ORIGINS: "https://dashboard-approved.example.test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.status === 200) {
        return {
          child,
          baseUrl,
          async close() {
            child.kill("SIGTERM");
            await new Promise((resolveChild, reject) => {
              child.once("exit", (code, signal) => {
                if (signal === "SIGTERM" || code === 0) {
                  resolveChild();
                } else {
                  reject(
                    new Error(
                      `CORS harness exited with ${signal ?? code}.\n${output}`,
                    ),
                  );
                }
              });
            });
          },
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 50));
  }

  child.kill("SIGKILL");
  throw new Error(`CORS harness did not start: ${lastError}.\n${output}`);
}

test("release API listener enforces approved and hostile-origin CORS", async () => {
  const approvedOrigin = "https://dashboard-approved.example.test";
  const hostileOrigin = "https://hostile.example.test";
  const harness = await startApiCorsHarness();

  try {
    const getResponse = await fetch(`${harness.baseUrl}/api/healthz`, {
      headers: { Origin: approvedOrigin },
    });
    assert.equal(getResponse.status, 200);
    assert.equal(
      getResponse.headers.get("access-control-allow-origin"),
      approvedOrigin,
    );
    assert.equal(
      getResponse.headers.get("access-control-allow-credentials"),
      "true",
    );

    const preflightResponse = await fetch(`${harness.baseUrl}/api/projects`, {
      method: "OPTIONS",
      headers: {
        Origin: approvedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, x-csrf-token",
      },
    });
    assert.equal(preflightResponse.status, 204);
    assert.equal(
      preflightResponse.headers.get("access-control-allow-origin"),
      approvedOrigin,
    );
    assert.equal(
      preflightResponse.headers.get("access-control-allow-credentials"),
      "true",
    );
    assert.match(
      preflightResponse.headers.get("access-control-allow-methods") ?? "",
      /\bPOST\b/,
    );
    assert.match(
      preflightResponse.headers.get("access-control-allow-headers") ?? "",
      /x-csrf-token/i,
    );

    const approvedMutation = await fetch(
      `${harness.baseUrl}/api/release-cors-contract`,
      {
        method: "POST",
        headers: { Origin: approvedOrigin, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.notEqual(
      approvedMutation.status,
      403,
      "approved state-changing origins must reach the API route layer",
    );
    assert.equal(
      approvedMutation.headers.get("access-control-allow-origin"),
      approvedOrigin,
    );
    assert.equal(
      approvedMutation.headers.get("access-control-allow-credentials"),
      "true",
    );

    const hostileMutation = await fetch(
      `${harness.baseUrl}/api/release-cors-contract`,
      {
        method: "POST",
        headers: { Origin: hostileOrigin, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(hostileMutation.status, 403);
    assert.equal(
      hostileMutation.headers.get("access-control-allow-origin"),
      null,
      "hostile state-changing origins must not receive CORS permission",
    );
  } finally {
    await harness.close();
  }
});

test("release API listener protects upload and live-update requests", async () => {
  const approvedOrigin = "https://dashboard-approved.example.test";
  const hostileOrigin = "https://hostile.example.test";
  const harness = await startApiCorsHarness();

  function expectApprovedCors(response, description) {
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      approvedOrigin,
      `${description} must receive approved-origin CORS permission`,
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      "true",
      `${description} must allow credentialed dashboard requests`,
    );
  }

  try {
    // A multipart request exercises the same shape sent by the dashboard
    // upload flow without creating a durable upload or invoking discovery.
    const uploadBody = new FormData();
    uploadBody.append(
      "archive",
      new Blob(["not an archive"], { type: "application/zip" }),
      "release-contract.zip",
    );
    const approvedUpload = await fetch(
      `${harness.baseUrl}/api/upload/archive`,
      {
        method: "POST",
        headers: { Origin: approvedOrigin },
        body: uploadBody,
      },
    );
    assert.equal(
      approvedUpload.status,
      422,
      "approved upload requests should reach archive validation without provider work",
    );
    expectApprovedCors(approvedUpload, "approved upload request");

    const hostileUploadBody = new FormData();
    hostileUploadBody.append(
      "archive",
      new Blob(["not an archive"], { type: "application/zip" }),
      "release-contract.zip",
    );
    const hostileUpload = await fetch(
      `${harness.baseUrl}/api/upload/archive`,
      {
        method: "POST",
        headers: { Origin: hostileOrigin },
        body: hostileUploadBody,
      },
    );
    assert.equal(
      hostileUpload.status,
      403,
      "hostile upload origins must be rejected before multipart handling",
    );
    assert.equal(
      hostileUpload.headers.get("access-control-allow-origin"),
      null,
      "hostile upload origins must not receive CORS permission",
    );

    // An invalid JSON payload stops before project/provider work while still
    // traversing the live stream route and its state-changing CORS guard.
    const approvedLiveUpdate = await fetch(
      `${harness.baseUrl}/api/ai/chat/stream`,
      {
        method: "POST",
        headers: {
          Origin: approvedOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(
      approvedLiveUpdate.status,
      400,
      "approved live-update requests should reach stream validation without provider work",
    );
    expectApprovedCors(approvedLiveUpdate, "approved live-update request");

    const hostileLiveUpdate = await fetch(
      `${harness.baseUrl}/api/ai/chat/stream`,
      {
        method: "POST",
        headers: {
          Origin: hostileOrigin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    assert.equal(
      hostileLiveUpdate.status,
      403,
      "hostile live-update origins must be rejected before stream handling",
    );
    assert.equal(
      hostileLiveUpdate.headers.get("access-control-allow-origin"),
      null,
      "hostile live-update origins must not receive CORS permission",
    );
  } finally {
    await harness.close();
  }
});

test("live journey timeout has Playwright headroom", () => {
  const providerTimeout = constant(journeySource, "DEFAULT_LIVE_TIMEOUT_MS");
  const testTimeoutMargin = constant(
    journeySource,
    "LIVE_TEST_TIMEOUT_MARGIN_MS",
  );
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
  assert.ok(
    browserEnvironment,
    "Could not locate the browser journey environment.",
  );
  assert.doesNotMatch(
    browserEnvironment[1],
    /DASHBOARD_E2E_LIVE_PROVIDER\s*:/,
    "The standard runner must not enable live provider execution.",
  );
});

test("the opt-in live journey requests and captures forensic proof", () => {
  assert.match(
    journeySource,
    /Perform a bounded forensic audit of this disposable project using read-only tools/,
    "The live journey must use an explicit forensic objective.",
  );
  assert.match(
    journeySource,
    /at least one accepted evidence item and one validation checkpoint/,
    "The live objective must require both proof surfaces.",
  );
  assert.match(
    journeySource,
    /evidenceCount/,
    "The live report capture must include accepted evidence.",
  );
  assert.match(
    journeySource,
    /const validation = recentSteps\.filter/,
    "The live report capture must include validation checkpoints.",
  );
});

test("the live journey requires an explicitly disposable project", () => {
  assert.match(
    journeySource,
    /DASHBOARD_E2E_LIVE_DISPOSABLE !== "1"/,
    "Live browser campaigns must not run against an unspecified or production project.",
  );
  assert.match(
    journeySource,
    /DASHBOARD_E2E_LIVE_PROJECT_ID/,
    "Live browser campaigns must identify their disposable project.",
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

test("release teardown writes a structured CI artifact", () => {
  assert.match(
    runnerSource,
    /release-teardown\.json/,
    "The release runner must write a stable teardown artifact.",
  );
  assert.match(
    runnerSource,
    /owningService: label/,
    "The teardown artifact must preserve the owning service.",
  );
  assert.match(
    runnerSource,
    /configuredPort: port/,
    "The teardown artifact must preserve the configured port.",
  );
  assert.match(
    runnerSource,
    /survivingPids:/,
    "The teardown artifact must preserve surviving process IDs.",
  );
  assert.match(
    runnerSource,
    /processGroup: child\.pid/,
    "The teardown artifact must preserve the release process group.",
  );
  assert.match(
    runnerSource,
    /cleanupOutcome:/,
    "The teardown artifact must preserve cleanup outcome.",
  );
  assert.match(
    runnerSource,
    /Release teardown artifact:/,
    "The release logs must surface the teardown artifact path.",
  );
});

test("release diagnostics expose a run-scoped summary and artifact link", () => {
  assert.match(
    runnerSource,
    /Release teardown evidence summary: validation run/,
    "The release runner must identify the validation run beside the retained artifact.",
  );
  assert.match(
    runnerSource,
    /Release teardown evidence coverage:/,
    "The release runner must identify the services and descendant coverage.",
  );

  assert.match(
    workflowSource,
    /Summarize retained release diagnostics/,
    "CI must publish a human-readable release diagnostics summary.",
  );
  assert.match(
    workflowSource,
    /actions\/runs\/\$\{\{ github\.run_id \}\}\/artifacts/,
    "The CI summary must link directly to the retained run artifacts.",
  );
  assert.match(
    workflowSource,
    /surviving descendants/,
    "The CI summary must identify descendant coverage for each service.",
  );
});

test("release diagnostics remain useful when teardown evidence is absent", () => {
  const missingEvidenceBranch = workflowSource.match(
    /if \[\[ -f "\$TEARDOWN_ARTIFACT" \]\]; then[\s\S]*?\n\s*else\s*\n([\s\S]*?)\n\s*fi\s*/,
  );
  assert.ok(
    missingEvidenceBranch,
    "CI must define an explicit fallback when teardown evidence is missing.",
  );

  const fallback = missingEvidenceBranch[1];
  assert.match(
    workflowSource,
    /Validation run: \[#\$\{\{ github\.run_number \}\}\]\(\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}\)/,
    "The CI summary must identify the validation run even without evidence.",
  );
  assert.match(
    workflowSource,
    /Retained teardown evidence: \[\$TEARDOWN_ARTIFACT_NAME\]\(\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}\/artifacts\)/,
    "The CI summary must retain the artifact location even without evidence.",
  );
  assert.match(
    fallback,
    /teardown evidence file was not produced; see the job log for the failure/,
    "The missing-evidence fallback must point operators to the job log for diagnostics.",
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

test("live campaign covers provider failures and candidate-bound delivery", () => {
  assert.match(
    journeySource,
    /provider-outage[\s\S]*malformed-output[\s\S]*delivery-success/,
    "The live campaign must define outage, malformed-output, and delivery-success scenarios.",
  );
  assert.match(
    journeySource,
    /OpenRouter rate-limit\/provider-exhaustion/,
    "The outage scenario must identify OpenRouter exhaustion.",
  );
  assert.match(
    journeySource,
    /AiChangesApplied[\s\S]*GitCommitCreated[\s\S]*GitPushed/,
    "Delivery success must observe apply, commit, and push events.",
  );
  assert.match(
    runnerSource,
    /MISSION_CORRELATION_REQUIRE_CANDIDATE:\s*"1"/,
    "Live reports must require candidate correlation.",
  );
});

test("release output reports redacted proof counts and non-success status", () => {
  assert.match(
    runnerSource,
    /formatMissionCorrelationSummary/,
    "The release runner must format the validated redacted report.",
  );
  assert.match(
    runnerSource,
    /console\.log\(formatMissionCorrelationSummary\(report\)\)/,
    "The release runner must print the validated summary.",
  );
});

test("release journey passes the complete approved origin list to API and browser checks", () => {
  assert.match(
    runnerSource,
    /const approvedDashboardOrigins = \(process\.env\.APP_ORIGINS \?\? ""\)/,
    "The release runner must derive checks from the configured APP_ORIGINS list.",
  );
  assert.match(
    runnerSource,
    /APP_ORIGINS: approvedDashboardOrigins\.join\(","\)/,
    "The release API must receive the same approved origin list.",
  );
  assert.match(
    runnerSource,
    /DASHBOARD_E2E_APPROVED_ORIGINS: approvedDashboardOrigins\.join\(","\)/,
    "Playwright must receive the same approved origin list.",
  );
  assert.match(
    journeySource,
    /for \(const origin of approvedDashboardOrigins\(\)\)/,
    "The browser journey must check every approved origin.",
  );
  assert.match(
    journeySource,
    /credentials.*allow-origin|access-control-allow-credentials/,
    "Approved-origin checks must verify credentialed CORS permission.",
  );
  assert.match(
    journeySource,
    /HOSTILE_ORIGIN[\s\S]*status\(\)\)\.toBe\(403\)/,
    "The browser journey must reject hostile state-changing origins.",
  );
});

test("origin failures preserve only sanitized phase and CORS diagnostics", () => {
  assert.match(
    journeySource,
    /DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH/,
    "The browser journey must write origin diagnostics for the release runner.",
  );
  for (const phase of ["GET", "preflight", "mutation", "rejection"]) {
    assert.match(
      journeySource,
      new RegExp(`"${phase}"`),
      `Origin diagnostics must identify the ${phase} request phase.`,
    );
  }
  assert.match(
    journeySource,
    /access-control-allow-origin[\s\S]*access-control-allow-methods[\s\S]*access-control-allow-headers[\s\S]*vary/,
    "Origin diagnostics must retain only relevant CORS response headers.",
  );
  assert.match(
    runnerSource,
    /DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH: originDiagnosticsPath/,
    "The release runner must pass the diagnostics path to Playwright.",
  );
  assert.match(
    runnerSource,
    /\.\.\.originDiagnostics/,
    "The release teardown artifact must retain origin diagnostics.",
  );
  assert.doesNotMatch(
    journeySource,
    /headers\[["'](?:cookie|set-cookie|authorization)["']\]/i,
    "Origin diagnostics must not read cookie or credential headers.",
  );
});
