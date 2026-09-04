#!/usr/bin/env tsx
/**
 * Apply and verify the compatibility transform required by the generated Zod
 * client. Orval currently emits zod.looseObject and zod.int for OpenAPI 3.1,
 * while this workspace uses Zod v3.
 *
 * This is deliberately a checked transform rather than a best-effort replace:
 * a zero-match result means Orval's output contract changed and must be
 * reviewed before codegen can succeed.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const LOOSE_OBJECT = "zod.looseObject(";
const OBJECT = "zod.object(";
const UUID = "zod.uuid()";
const STRING_UUID = "zod.string().uuid()";
const INT = "zod.int()";
const NUMBER_INT = "zod.number().int()";
const EXECUTION_LEDGER_CONSTANT =
  /^export const [A-Za-z0-9]+ExecutionLedger[A-Za-z0-9]* = [^\n]+;\n?/gm;

/**
 * Orval can emit inline response constraints after the response schema that
 * references them. JavaScript evaluates the schema initializer immediately,
 * so those constants must be hoisted to avoid a temporal-dead-zone failure.
 */
function hoistExecutionLedgerConstants(content: string): string {
  const declarations: string[] = [];
  const withoutDeclarations = content.replace(
    EXECUTION_LEDGER_CONSTANT,
    (declaration) => {
      declarations.push(declaration.trimEnd());
      return "";
    },
  );

  if (declarations.length === 0) return content;

  const importMarker = "import * as zod from 'zod';";
  const importEnd = withoutDeclarations.indexOf(importMarker);
  if (importEnd < 0) {
    throw new Error(
      "Generated Zod output is missing the expected zod import; cannot hoist execution-ledger constraints.",
    );
  }
  const insertionPoint = importEnd + importMarker.length;
  return [
    withoutDeclarations.slice(0, insertionPoint),
    "",
    declarations.join("\n"),
    withoutDeclarations.slice(insertionPoint),
  ].join("\n");
}

export function patchGeneratedZod(filePath: string): number {
  const path = resolve(filePath);
  let content: string;

  try {
    content = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      [
        `Generated Zod output is missing: ${filePath}.`,
        "Orval may have changed its output path; update the codegen target and post-processing step.",
      ].join("\n"),
    );
  }

  const matches = content.split(LOOSE_OBJECT).length - 1;
  if (matches === 0) {
    throw new Error(
      [
        `Generated Zod output contains no '${LOOSE_OBJECT}' markers.`,
        "The required post-codegen transform was not applied because Orval's output format may have changed.",
        "Review the Orval upgrade/output and update scripts/patch-generated-zod.ts before regenerating.",
      ].join("\n"),
    );
  }

  const intMatches = content.split(INT).length - 1;
  const patched = content
    .replaceAll(LOOSE_OBJECT, OBJECT)
    .replaceAll(UUID, STRING_UUID)
    .replaceAll(INT, NUMBER_INT);
  const normalized = hoistExecutionLedgerConstants(patched);
  const remaining = normalized.split(LOOSE_OBJECT).length - 1;
  const remainingInts = normalized.split(INT).length - 1;
  const transformed = normalized.split(OBJECT).length - 1;

  if (remaining !== 0 || remainingInts !== 0 || transformed < matches) {
    throw new Error(
      [
        `Zod post-processing was incomplete: expected ${matches} replacements, applied ${transformed - (content.split(OBJECT).length - 1)}.`,
        `Expected ${intMatches} integer compatibility replacements, but ${remainingInts} zod.int() markers remain.`,
        "Update the post-codegen transform before committing generated output.",
      ].join("\n"),
    );
  }

  writeFileSync(path, `${normalized.trimEnd()}\n`);
  return matches;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) {
    console.error("Usage: patch-generated-zod.ts <generated-zod-file>");
    process.exit(1);
  }

  try {
    const count = patchGeneratedZod(filePath);
    console.log(`✅  Applied ${count} Zod looseObject compatibility transforms.`);
  } catch (error) {
    console.error("❌  Zod post-codegen verification failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}