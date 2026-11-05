import { ESLint } from "eslint";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDirectory, "..");
const baselinePath = path.join(packageRoot, "eslint-baseline.json");
const isBaselineUpdate = process.argv.includes("--update-baseline");

const eslint = new ESLint({ cwd: packageRoot });
const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
const findings = new Map();
const newFindings = [];
let baseline = {};
let baselineLoaded = false;

if (!isBaselineUpdate) {
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    baselineLoaded = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

for (const result of results) {
  const relativePath = path.relative(packageRoot, result.filePath).split(path.sep).join("/");

  for (const message of result.messages) {
    if (message.severity === 0) continue;

    const fingerprint = JSON.stringify([
      relativePath,
      message.ruleId ?? "eslint",
      message.severity,
      message.message.split(/\n\n/)[0],
    ]);
    const occurrence = (findings.get(fingerprint) ?? 0) + 1;
    findings.set(fingerprint, occurrence);
    if (isBaselineUpdate || occurrence > (baseline[fingerprint] ?? 0)) {
      newFindings.push({
        fingerprint,
        file: relativePath,
        line: message.line ?? 1,
        column: message.column ?? 1,
        ruleId: message.ruleId ?? "eslint",
        message: message.message.split(/\n\n/)[0],
      });
    }
  }
}

const currentBaseline = Object.fromEntries(
  [...findings.entries()].sort(([left], [right]) => left.localeCompare(right)),
);

if (isBaselineUpdate) {
  await writeFile(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`);
  console.log(`Updated ${path.relative(packageRoot, baselinePath)} with ${newFindings.length} findings.`);
  process.exit(0);
}

if (!baselineLoaded) {
  console.error("Lint baseline is missing. Review findings, then run `pnpm run lint:baseline:update`.");
  process.exit(1);
}

for (const finding of newFindings) {
  console.error(
    `${finding.file}:${finding.line}:${finding.column} ${finding.ruleId}: ${finding.message}`,
  );
}

const addedFindings = [...findings.entries()].reduce((total, [fingerprint, count]) => {
  return total + Math.max(0, count - (baseline[fingerprint] ?? 0));
}, 0);

const baselineEntries = Object.entries(baseline);
const outstandingBaselineFindings = baselineEntries.reduce(
  (total, [fingerprint, count]) => total + Math.min(count, findings.get(fingerprint) ?? 0),
  0,
);

if (addedFindings > 0) {
  console.error(
    `Lint failed: ${addedFindings} new finding(s); ${outstandingBaselineFindings} pre-existing finding(s) remain.`,
  );
  process.exit(1);
}

console.log(
  `Lint passed: ${outstandingBaselineFindings} pre-existing finding(s) remain within the reviewed baseline.`,
);
