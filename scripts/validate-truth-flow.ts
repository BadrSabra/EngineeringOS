#!/usr/bin/env tsx
/**
 * Truth Flow Matrix — drift gate.
 *
 * Reads the canonical truth-flow JSON baseline and validates it against
 * CurrentTruthFlowMatrixSchema from @workspace/api-zod.
 *
 * Validation is two-layered (mirrors the schema hierarchy):
 *
 *   Layer 1 — Structural gate (TruthFlowMatrixSchema):
 *             Is the JSON a well-formed truth-flow matrix at all?
 *             Fails if required fields are missing or paths are malformed.
 *
 *   Layer 2 — Baseline drift gate (CurrentTruthFlowMatrixSchema + listTruthFlowDriftSignals):
 *             Does the JSON exactly match EXPECTED_CURRENT_TRUTH_FLOW_MATRIX?
 *             Fails if any node is missing, added, or has a status/confidence/path mismatch.
 *             A drift here means someone updated the JSON without updating the schema
 *             constant, or vice-versa — both must move together.
 *
 * Data categories in play:
 *   BASELINE  — EXPECTED_CURRENT_TRUTH_FLOW_MATRIX in truth-flow-matrix.schema.ts
 *   DERIVED   — listTruthFlowDriftSignals() output (ephemeral, never persisted)
 *   HISTORICAL — attached_assets/* (context only; not validated here)
 *   RUNTIME   — live graph/scan output (informs future baseline updates; not validated here)
 *
 * Usage:
 *   pnpm run truth:validate
 *
 * Exit codes:
 *   0 — matrix is aligned with the current baseline (no drift)
 *   1 — drift detected; see output for the specific signals and fix instructions
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
const SCHEMA_SOURCE =
  "lib/api-zod/src/truth-flow-matrix.schema.ts → EXPECTED_CURRENT_TRUTH_FLOW_MATRIX";

// ─── 1. Parse JSON ────────────────────────────────────────────────────────────

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(MATRIX_PATH, "utf-8"));
} catch (err: unknown) {
  console.error(`\n❌  [Layer 1 – I/O] Cannot read truth-flow matrix.`);
  console.error(`    Path: ${MATRIX_PATH}`);
  console.error(`    Error: ${(err as Error).message}`);
  console.error(`\n    Fix: ensure the file exists and is valid JSON.\n`);
  process.exit(1);
}

// ─── 2. Layer 1 — Structural validation ──────────────────────────────────────

if (!isTruthFlowMatrix(raw)) {
  console.error(`\n❌  [Layer 1 – Structural] Truth Flow Matrix JSON is malformed.`);
  console.error(`    Required shape: { title, version, description, nodes[] }`);
  console.error(`    Each node requires: node, status, confidence, nextAction, exactRepoPaths[]\n`);
  process.exit(1);
}

// ─── 3. Layer 2 — Baseline drift gate ────────────────────────────────────────

const signals = listTruthFlowDriftSignals(raw);
const result = safeValidateCurrentTruthFlowMatrix(raw);

if (result.success && signals.length === 0) {
  console.log(
    `\n✅  Truth Flow Matrix is aligned with the current baseline.\n` +
    `    Baseline: ${SCHEMA_SOURCE}\n` +
    `    Matrix:   ${MATRIX_PATH}\n`,
  );
  process.exit(0);
}

// ─── 4. Report drift (explicit failure) ──────────────────────────────────────

console.error(`\n❌  [Layer 2 – Baseline Drift] Truth Flow Matrix has drifted from the baseline.\n`);

if (signals.length > 0) {
  console.error(`  Drift signals (${signals.length}):`);
  for (const sig of signals) {
    console.error(`    [${sig.type}] ${sig.node}: ${sig.message}`);
  }
}

if (!result.success) {
  console.error(`\n  Schema validation errors (${result.error.issues.length}):`);
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
    console.error(`    • ${path}${issue.message}`);
  }
}

console.error(`
  What drifted:  see signals above — each signal names the node, type, and message.
  Where it is:   ${MATRIX_PATH}
  Baseline at:   ${SCHEMA_SOURCE}

  How to fix:
    Option A — The JSON is the source of truth: update EXPECTED_CURRENT_TRUTH_FLOW_MATRIX
               in ${SCHEMA_SOURCE} to match the JSON.
    Option B — The baseline is the source of truth: revert the JSON to match
               EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.

  Then re-run:   pnpm run truth:validate
`);

process.exit(1);
