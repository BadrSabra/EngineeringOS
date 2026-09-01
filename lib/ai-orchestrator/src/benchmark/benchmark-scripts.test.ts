import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  scripts?: Record<string, string>;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const retiredScenarioPath = path.join(
  packageRoot,
  "src",
  "benchmark-scenarios",
  "runtime-oracle" + ".test.ts",
);
const retiredScriptName = ["test", "runtime-oracle"].join(":");

describe("benchmark script registration", () => {
  it("does not advertise the retired standalone runtime-oracle check", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.scripts?.[retiredScriptName]).toBeUndefined();
    expect(existsSync(retiredScenarioPath)).toBe(false);
    expect(manifest.scripts?.["test:benchmark-scenarios"]).toBe(
      "vitest run src/benchmark-scenarios --passWithNoTests",
    );
    expect(manifest.scripts?.["validate:benchmark-scenarios"]).toBe(
      "tsx src/benchmark/validate-code-agent-benchmark-scenarios.ts",
    );
  });
});