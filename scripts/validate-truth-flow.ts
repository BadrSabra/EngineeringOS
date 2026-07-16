#!/usr/bin/env tsx
/**
 * Truth Flow Matrix validation gate.
 *
 * Reads the canonical truth-flow JSON baseline and validates it against
 * CurrentTruthFlowMatrixSchema from @workspace/api-zod.
 *
 * Fails loudly if the JSON drifts from EXPECTED_CURRENT_TRUTH_FLOW_MATRIX —
 * meaning someone updated the JSON without updating the schema constant, or
 * vice-versa.
 *
 * Usage:
 *   pnpm run truth:validate
 *
 * Exit codes:
 *   0 — matrix is aligned with the current baseline
 *   1 — drift detected; update EXPECTED_CURRENT_TRUTH_FLOW_MATRIX in
 *       lib/api-zod/src/truth-flow-matrix.schema.ts to match the JSON
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  safeValidateCurrentTruthFlowMatrix,
  listTruthFlowDriftSignals,
  isTruthFlowMatrix,
} from "@workspace/api-zod";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "..");
const MATRIX_PATH = resolve(
  WORKSPACE_ROOT,
  "attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json",
);

// ─── 1. Parse JSON ────────────────────────────────────────────────────────────

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(MATRIX_PATH, "utf-8"));
} catch (err: unknown) {
  console.error(`❌  Could not read truth-flow matrix at ${MATRIX_PATH}`);
  console.error((err as Error).message);
  process.exit(1);
}

// ─── 2. Basic structural validation ─────────────────────────────────────────

if (!isTruthFlowMatrix(raw)) {
  console.error("❌  Truth Flow Matrix JSON is not a valid TruthFlowMatrix.");
  console.error("    Check that it has: title, version, description, nodes[]");
  process.exit(1);
}

// ─── 3. Drift signals against the current baseline ──────────────────────────

const signals = listTruthFlowDriftSignals(raw);
const result = safeValidateCurrentTruthFlowMatrix(raw);

if (result.success && signals.length === 0) {
  console.log("✅  Truth Flow Matrix is aligned with the current baseline.");
  process.exit(0);
}

// ─── 4. Report drift ─────────────────────────────────────────────────────────

console.error("\n❌  Truth Flow Matrix drift detected.\n");

if (signals.length > 0) {
  console.error("  Drift signals:");
  for (const sig of signals) {
    console.error(`    [${sig.type}] ${sig.node}: ${sig.message}`);
  }
}

if (!result.success) {
  console.error("\n  Schema validation errors:");
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
    console.error(`    • ${path}${issue.message}`);
  }
}

console.error(
  "\n  Fix: update EXPECTED_CURRENT_TRUTH_FLOW_MATRIX in",
  "\n       lib/api-zod/src/truth-flow-matrix.schema.ts",
  "\n       to match the JSON, then re-run `pnpm run truth:validate`.\n",
);

process.exit(1);
