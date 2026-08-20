#!/usr/bin/env tsx
/**
 * Apply and verify the compatibility transform required by the generated Zod
 * client. Orval currently emits zod.looseObject for OpenAPI 3.1, while this
 * workspace uses Zod v3.
 *
 * This is deliberately a checked transform rather than a best-effort replace:
 * a zero-match result means Orval's output contract changed and must be
 * reviewed before codegen can succeed.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const LOOSE_OBJECT = "zod.looseObject(";
const OBJECT = "zod.object(";

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

  const patched = content.replaceAll(LOOSE_OBJECT, OBJECT);
  const remaining = patched.split(LOOSE_OBJECT).length - 1;
  const transformed = patched.split(OBJECT).length - 1;

  if (remaining !== 0 || transformed < matches) {
    throw new Error(
      [
        `Zod post-processing was incomplete: expected ${matches} replacements, applied ${transformed - (content.split(OBJECT).length - 1)}.`,
        "Update the post-codegen transform before committing generated output.",
      ].join("\n"),
    );
  }

  writeFileSync(path, patched);
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