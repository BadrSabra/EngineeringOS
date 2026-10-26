import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

test("writes Playwright artifacts directly under this lifecycle run", async ({}, testInfo) => {
  const runId = process.env.ENGINEERING_AGENT_LIFECYCLE_RUN_ID ?? "";
  const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const expectedOutputDir = resolve(
    workspaceRoot,
    "test-results/engineering-agent-lifecycle",
    runId,
    "playwright",
  );
  expect(runId).toMatch(/^[a-f0-9-]{36}$/i);
  const testOutputDir = resolve(testInfo.outputDir);
  const relativeOutputDir = relative(expectedOutputDir, testOutputDir);
  expect(isAbsolute(testOutputDir)).toBe(true);
  expect(relativeOutputDir).not.toBe("");
  expect(relativeOutputDir).not.toBe("..");
  expect(relativeOutputDir.startsWith(`..${sep}`)).toBe(false);

  const sentinelPath = testInfo.outputPath("output-contract-sentinel.txt");
  await writeFile(sentinelPath, runId, "utf8");
  await expect(readFile(sentinelPath, "utf8")).resolves.toBe(runId);
});
