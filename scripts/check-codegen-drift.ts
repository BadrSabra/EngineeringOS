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
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join, relative, resolve, sep } from "path";

const WORKSPACE_ROOT = resolve(import.meta.dirname, "..");

const GENERATED_PATHS = [
  "lib/api-zod/src/generated",
  "lib/api-client-react/src/generated",
];

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
//
// Generate into a temporary workspace instead of the checked-out generated
// directories. A failed check must not leave codegen output in the worktree.

const generatedRoot = mkdtempSync(join(tmpdir(), "api-codegen-drift-"));
const temporaryMutator = join(
  generatedRoot,
  "lib/api-client-react/src/custom-fetch.ts",
);
mkdirSync(join(generatedRoot, "lib/api-client-react/src"), { recursive: true });
copyFileSync(
  join(WORKSPACE_ROOT, "lib/api-client-react/src/custom-fetch.ts"),
  temporaryMutator,
);

function listFiles(directory: string, root = directory): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory()
        ? listFiles(entryPath, root)
        : [relative(root, entryPath)];
    });
  } catch {
    return [];
  }
}

function compareGeneratedPath(path: string): string[] {
  const expectedPath = join(WORKSPACE_ROOT, path);
  const actualPath = join(generatedRoot, path);
  const files = new Set([...listFiles(expectedPath), ...listFiles(actualPath)]);

  return [...files]
    .filter((file) => {
      const expectedFile = join(expectedPath, file);
      const actualFile = join(actualPath, file);
      try {
        if (
          !statSync(expectedFile).isFile() ||
          !statSync(actualFile).isFile()
        ) {
          return true;
        }
        return !readFileSync(expectedFile).equals(readFileSync(actualFile));
      } catch {
        return true;
      }
    })
    .map((file) => join(path, file));
}

// ─── 2. Verify the temporary mutator import is deterministic ────────────────
//
// Orval resolves the mutator from the configured output root. When that root
// changes, the generated import must still be relative to the generated file,
// not an absolute path containing the temporary directory. This check keeps a
// future Orval/mutator change from producing output that only works in the
// drift-check sandbox (or differs from the committed client).
function verifyCustomFetchImport(): void {
  const generatedApiPath = join(
    generatedRoot,
    "lib/api-client-react/src/generated/api.ts",
  );
  const generatedMutatorPath = join(
    generatedRoot,
    "lib/api-client-react/src/custom-fetch.ts",
  );
  const expectedImport = relative(
    dirname(generatedApiPath),
    generatedMutatorPath,
  )
    .replace(/\.ts$/, "")
    .split(sep)
    .join("/");

  let content: string;
  try {
    content = readFileSync(generatedApiPath, "utf8");
  } catch {
    throw new Error(
      "Generated React client is missing lib/api-client-react/src/generated/api.ts.",
    );
  }

  const imports = [
    ...content.matchAll(
      /import(?:\s+type)?\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]*custom-fetch[^'"]*)['"]/g,
    ),
  ].map((match) => match[1]);

  if (imports.length === 0) {
    throw new Error(
      "Generated React client does not import custom-fetch; the Orval mutator may no longer be configured.",
    );
  }

  const unexpected = imports.filter((specifier) => specifier !== expectedImport);
  if (unexpected.length > 0 || imports.length !== 2) {
    throw new Error(
      [
        "Generated React client has a non-deterministic custom-fetch import.",
        `Expected both type and runtime imports to be '${expectedImport}', but found: ${imports.join(", ") || "(none)"}.`,
        "Keep the Orval mutator path rooted at CODEGEN_OUTPUT_ROOT and use a relative import from generated/api.ts.",
      ].join("\n"),
    );
  }
}

console.log("⏳  Running codegen from lib/api-spec/openapi.yaml …");
try {
  // Suppress stdout from codegen unless it fails (we only care about drift)
  execSync("pnpm --filter @workspace/api-spec run codegen", {
    cwd: WORKSPACE_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      CODEGEN_OUTPUT_ROOT: generatedRoot,
    },
  });
} catch (err: any) {
  console.error("❌  Codegen failed — fix the OpenAPI spec first:");
  console.error(err.stderr?.toString() ?? err.message);
  rmSync(generatedRoot, { recursive: true, force: true });
  process.exit(1);
}

try {
  verifyCustomFetchImport();
  console.log("✅  custom-fetch mutator imports are deterministic.");
} catch (err) {
  console.error("❌  Mutator import verification failed:");
  console.error(err instanceof Error ? err.message : String(err));
  rmSync(generatedRoot, { recursive: true, force: true });
  process.exit(1);
}

// ─── 3. Check the generated output against the committed output ─────────────

console.log("🔍  Checking for uncommitted changes in generated files …");

const changed = GENERATED_PATHS.flatMap(compareGeneratedPath);

// The api-spec codegen command now owns and verifies the post-processing step.
// If Orval changes its output format, that command fails before this comparison
// and explains how to update the transform; never silently accept a no-op.

if (changed.length === 0) {
  console.log("✅  Generated files are in sync with openapi.yaml.");
  rmSync(generatedRoot, { recursive: true, force: true });
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
  rmSync(generatedRoot, { recursive: true, force: true });
  process.exit(1);
}
