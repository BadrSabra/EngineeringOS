#!/usr/bin/env tsx
/**
 * Truth Flow Matrix — deterministic baseline materializer/checker.
 *
 * EXPECTED_CURRENT_TRUTH_FLOW_MATRIX is the authority. This script never reads
 * historical files or runtime evidence to fill in baseline values.
 *
 * Usage:
 *   pnpm run truth:baseline:check
 *   pnpm run truth:baseline:materialize
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { EXPECTED_CURRENT_TRUTH_FLOW_MATRIX } from "@workspace/api-zod";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "..");
const MATRIX_PATH = resolve(
  WORKSPACE_ROOT,
  "attached_assets/EngineeringOS_Truth_Flow_Matrix_1784143389833.json",
);
const SCHEMA_SOURCE =
  "lib/api-zod/src/truth-flow-matrix.schema.ts → EXPECTED_CURRENT_TRUTH_FLOW_MATRIX";
const generated = `${JSON.stringify(EXPECTED_CURRENT_TRUTH_FLOW_MATRIX, null, 2)}\n`;
const shouldMaterialize = process.argv.includes("--write");

if (shouldMaterialize) {
  writeFileSync(MATRIX_PATH, generated, "utf-8");
  console.log(
    `\n✅  Materialized the Truth Flow Matrix from the schema baseline.\n` +
      `    Authority: ${SCHEMA_SOURCE}\n` +
      `    Matrix:    ${MATRIX_PATH}\n` +
      `\n    Review the generated diff, then run: pnpm run truth:validate\n`,
  );
  process.exit(0);
}

if (!existsSync(MATRIX_PATH)) {
  console.error(
    `\n❌  Truth Flow Matrix baseline is missing.\n` +
      `    Expected:  ${MATRIX_PATH}\n` +
      `    Authority: ${SCHEMA_SOURCE}\n` +
      `\n    No values were inferred from historical or runtime files.\n` +
      `    To create the reviewable JSON representation from the schema, run:\n` +
      `      pnpm run truth:baseline:materialize\n` +
      `    Then inspect the diff and run:\n` +
      `      pnpm run truth:validate\n`,
  );
  process.exit(1);
}

const actual = readFileSync(MATRIX_PATH, "utf-8");
if (actual !== generated) {
  console.error(
    `\n❌  Truth Flow Matrix baseline drifted from the schema authority.\n` +
      `    Matrix:    ${MATRIX_PATH}\n` +
      `    Authority: ${SCHEMA_SOURCE}\n` +
      `\n    The generated representation is deterministic. Do not hand-edit values\n` +
      `    or recover them from historical files. Review the intended schema change,\n` +
      `    then run pnpm run truth:baseline:materialize and inspect the focused diff.\n` +
      `    Finish with: pnpm run truth:validate\n`,
  );
  process.exit(1);
}

console.log(
  `\n✅  Truth Flow Matrix JSON matches the schema authority.\n` +
    `    Authority: ${SCHEMA_SOURCE}\n` +
    `    Matrix:    ${MATRIX_PATH}\n`,
);