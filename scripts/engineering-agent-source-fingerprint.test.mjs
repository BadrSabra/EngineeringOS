import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeEngineeringAgentSourceFingerprint } from "./engineering-agent-source-fingerprint.mjs";

test("source fingerprint is stable and changes with exact source bytes", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "engineering-agent-fingerprint-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
    await writeFile(join(root, "app.ts"), "export const value = 1;\n");
    await writeFile(join(root, "README.md"), "docs are outside the source contract\n");
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules", "ignored.ts"), "ignored\n");

    const first = await computeEngineeringAgentSourceFingerprint({ cwd: root });
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(
      await computeEngineeringAgentSourceFingerprint({ cwd: root }),
      first,
    );

    await writeFile(join(root, "app.ts"), "export const value = 2;\n");
    const changed = await computeEngineeringAgentSourceFingerprint({ cwd: root });
    assert.notEqual(changed, first);
    await writeFile(join(root, "README.md"), "new docs only\n");
    assert.equal(
      await computeEngineeringAgentSourceFingerprint({ cwd: root }),
      changed,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
