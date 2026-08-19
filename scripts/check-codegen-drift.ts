#!/usr/bin/env tsx
/**
 * Codegen drift check — CI guard against OpenAPI contract drift.
 *
 * Runs the codegen step, then checks whether any generated files changed.
 * If the generated output differs from what is committed, the developer
 * forgot to regenerate after editing openapi.yaml, and this script fails
 * loudly so CI catches it before it reaches main.
 *
 * Usage:
 *   pnpm run check-codegen-drift
 *
 * Exit codes:
 *   0 — generated files are in sync with openapi.yaml
 *   1 — drift detected; run `pnpm --filter @workspace/api-spec run codegen` to fix
 */

import { execSync } from "child_process";
import { resolve } from "path";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "..");

function run(cmd: string): string {
  return execSync(cmd, { cwd: WORKSPACE_ROOT, encoding: "utf-8" });
}

// ─── 0. Parse-check the spec BEFORE codegen (PR-01) ──────────────────────────
//
// Fail immediately with a clear message if openapi.yaml has YAML syntax errors
// or structural issues. This prevents an opaque Orval error that would otherwise
// mask the real problem.

console.log("🔎  Checking openapi.yaml parseability …");
try {
  execSync("pnpm --filter @workspace/scripts run parse-check-spec", {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
  });
} catch {
  // parse-check-spec already printed the error; just exit.
  process.exit(1);
}

// ─── 1. Regenerate from the current openapi.yaml ─────────────────────────────

console.log("⏳  Running codegen from lib/api-spec/openapi.yaml …");
try {
  // Suppress stdout from codegen unless it fails (we only care about drift)
  execSync("pnpm --filter @workspace/api-spec run codegen", {
    cwd: WORKSPACE_ROOT,
    stdio: "pipe",
  });
} catch (err: any) {
  console.error("❌  Codegen failed — fix the OpenAPI spec first:");
  console.error(err.stderr?.toString() ?? err.message);
  process.exit(1);
}

// ─── 2. Check for uncommitted changes in generated directories ───────────────

const GENERATED_PATHS = [
  "lib/api-zod/src/generated",
  "lib/api-client-react/src/generated",
];

console.log("🔍  Checking for uncommitted changes in generated files …");

const changed: string[] = [];

for (const path of GENERATED_PATHS) {
  // git diff --name-only shows tracked files that changed.
  // git ls-files --others shows untracked new files.
  const diff = run(`git diff --name-only -- "${path}"`).trim();
  const untracked = run(`git ls-files --others --exclude-standard -- "${path}"`).trim();

  if (diff) changed.push(...diff.split("\n").filter(Boolean));
  if (untracked) changed.push(...untracked.split("\n").filter(Boolean));
}

// ─── 3. Report ───────────────────────────────────────────────────────────────

// ─── 3. Post-codegen verify: no looseObject should remain (PR-05) ────────────
//
// The codegen script runs a sed patch to replace z.looseObject (Orval/Zod v4
// compatibility shim) with z.object (Zod v3 semantics). Verify the patch worked
// so that a future Orval upgrade does not silently re-introduce looseObject.

console.log("🔍  Verifying codegen output has no looseObject remnants …");
const generatedZodFile = "lib/api-zod/src/generated/api.ts";
try {
  const generatedContent = run(`cat "${generatedZodFile}"`);
  if (generatedContent.includes("looseObject")) {
    console.error("❌  Post-codegen verify failed:");
    console.error(
      `    ${generatedZodFile} still contains 'looseObject' after the sed patch.`,
    );
    console.error(
      "    The sed substitution in lib/api-spec/package.json may need updating.",
    );
    process.exit(1);
  }
  console.log("✅  No looseObject remnants in generated Zod output.");
} catch {
  // If the file doesn't exist yet (first run), skip the check.
  console.warn(`⚠️   Could not verify ${generatedZodFile} — skipping looseObject check.`);
}

// ─── 4. Report ───────────────────────────────────────────────────────────────

if (changed.length === 0) {
  console.log("✅  Generated files are in sync with openapi.yaml.");
  process.exit(0);
} else {
  console.error("\n❌  Generated files are out of sync with openapi.yaml.");
  console.error(
    "    These files changed after re-running codegen — commit the regenerated output:\n",
  );
  for (const f of changed) {
    console.error(`    • ${f}`);
  }
  console.error(
    "\n    Fix: pnpm --filter @workspace/api-spec run codegen && git add lib/api-zod lib/api-client-react\n",
  );
  process.exit(1);
}
