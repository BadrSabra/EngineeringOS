#!/usr/bin/env tsx
/**
 * PR-01: OpenAPI spec parse-check — CI gate against a broken source-of-truth.
 *
 * Validates that `lib/api-spec/openapi.yaml` can be parsed cleanly *before*
 * any codegen runs. A broken YAML produces an opaque Orval error that masks
 * the root cause; this script surfaces it immediately with a clear message.
 *
 * Usage:
 *   pnpm run parse-check-spec         # from workspace root
 *   pnpm --filter @workspace/api-spec run parse-check   # from api-spec package
 *
 * Exit codes:
 *   0 — openapi.yaml parses and validates as a minimal OpenAPI 3.x document
 *   1 — parse or structure error; fix openapi.yaml before running codegen
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SPEC_PATH = resolve(import.meta.dirname, "..", "lib", "api-spec", "openapi.yaml");

// ─── 1. Read ────────────────────────────────────────────────────────────────

let raw: string;
try {
  raw = readFileSync(SPEC_PATH, "utf-8");
} catch (err: any) {
  console.error(`❌  Cannot read ${SPEC_PATH}:`);
  console.error(`    ${err.message}`);
  process.exit(1);
}

if (!raw.trim()) {
  console.error("❌  openapi.yaml is empty.");
  process.exit(1);
}

// ─── 2. Parse via dynamic import of js-yaml ─────────────────────────────────
//
// js-yaml is a devDependency of @workspace/api-spec (used internally by Orval).
// We import it dynamically so this script runs in the @workspace/scripts
// package without needing its own explicit dependency on it.

let doc: any;
try {
  // js-yaml is hoisted from Orval's deps in the pnpm workspace.
  const jsYaml = await import("js-yaml");
  doc = jsYaml.load(raw);
} catch (err: any) {
  console.error("❌  openapi.yaml failed to parse as YAML:");
  console.error(`    ${err.message}`);
  if (err.mark) {
    console.error(`    Line ${err.mark.line + 1}, column ${err.mark.column + 1}`);
  }
  console.error(
    "\n    Fix the YAML syntax error in lib/api-spec/openapi.yaml before running codegen.\n",
  );
  process.exit(1);
}

// ─── 3. Structural sanity checks ────────────────────────────────────────────

const issues: string[] = [];

if (typeof doc !== "object" || doc === null) {
  issues.push("Root document is not an object.");
}

if (!doc?.openapi || !String(doc.openapi).startsWith("3.")) {
  issues.push(`Missing or unsupported 'openapi' version: ${JSON.stringify(doc?.openapi)}`);
}

if (!doc?.info?.title) {
  issues.push("Missing 'info.title'.");
}

if (!doc?.paths || typeof doc.paths !== "object") {
  issues.push("Missing 'paths' object.");
}

if (!doc?.components?.schemas || typeof doc.components.schemas !== "object") {
  issues.push("Missing 'components.schemas' — contract schemas are required.");
}

if (!doc?.components?.securitySchemes) {
  issues.push("Missing 'components.securitySchemes' — auth contract is required.");
}

// Check for a global security declaration or note its absence
const hasGlobalSecurity = Array.isArray(doc?.security) && doc.security.length > 0;
if (!hasGlobalSecurity) {
  // This is a warning, not a hard failure — during the PR-02 migration window
  // per-operation security is still valid.
  console.warn(
    "⚠️   No global 'security:' declaration found. Consider adding a global default" +
    " so new routes are protected by default. See PR-02.",
  );
}

// Detect unresolvable $ref targets (shallow check — not a full validator)
const specStr = JSON.stringify(doc);
const inlineRefs = [...specStr.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map(
  (m) => m[1],
);
const definedSchemas = new Set(Object.keys(doc?.components?.schemas ?? {}));
const missing = [...new Set(inlineRefs)].filter((r) => !definedSchemas.has(r));
if (missing.length > 0) {
  issues.push(
    `Unresolvable $ref targets in components/schemas: ${missing.join(", ")}`,
  );
}

if (issues.length > 0) {
  console.error("❌  openapi.yaml has structural issues:");
  for (const issue of issues) {
    console.error(`    • ${issue}`);
  }
  console.error(
    "\n    Fix these issues in lib/api-spec/openapi.yaml before running codegen.\n",
  );
  process.exit(1);
}

// ─── 4. Summary ─────────────────────────────────────────────────────────────

const pathCount = Object.keys(doc.paths).length;
const schemaCount = Object.keys(doc.components.schemas).length;
const opCount = Object.values(doc.paths as Record<string, any>).reduce(
  (n: number, path: any) =>
    n + Object.keys(path).filter((k) => ["get","post","put","patch","delete","head","options"].includes(k)).length,
  0,
);

console.log(`✅  openapi.yaml parses cleanly.`);
console.log(`    Version : ${doc.openapi}`);
console.log(`    Paths   : ${pathCount}  Operations: ${opCount}  Schemas: ${schemaCount}`);
if (hasGlobalSecurity) {
  console.log(`    Security: global default set ✓`);
}
