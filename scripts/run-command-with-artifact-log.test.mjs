import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCommandWithArtifactLog } from "./run-command-with-artifact-log.mjs";

test("failed child output is preserved in a bounded artifact log", async () => {
  const directory = await mkdtemp(join(os.tmpdir(), "command-artifact-log-"));
  const outputPath = join(directory, "browser-journey.log");
  try {
    await assert.rejects(
      runCommandWithArtifactLog(
        process.execPath,
        [
          "-e",
          "process.stdout.write('x'.repeat(2048)); process.stderr.write('failure detail'); process.exit(7)",
        ],
        {
          cwd: directory,
          env: { PATH: process.env.PATH ?? "" },
          label: "fixture browser journey",
          outputPath,
          maxLogBytes: 256,
        },
      ),
      /fixture browser journey failed \(7\); see .*browser-journey\.log/u,
    );

    const output = await readFile(outputPath, "utf8");
    assert.ok(Buffer.byteLength(output) <= 256 + 64);
    assert.match(output, /earlier output truncated/u);
    assert.match(output, /failure detail/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
