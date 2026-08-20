import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { patchGeneratedZod } from "./patch-generated-zod";

async function withTemporaryFile(
  content: string,
  callback: (filePath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "patch-generated-zod-"));
  const filePath = join(directory, "generated.ts");

  try {
    await writeFile(filePath, content, "utf8");
    await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("converts every generated looseObject marker", async () => {
  const generated = [
    "const first = zod.looseObject({ id: zod.string() });",
    "const second = zod.looseObject({ name: zod.string() });",
    "const nested = zod.object({ child: zod.looseObject({ value: zod.number() }) });",
  ].join("\n");

  await withTemporaryFile(generated, async (filePath) => {
    assert.equal(patchGeneratedZod(filePath), 3);

    const patched = await readFile(filePath, "utf8");
    assert.equal(patched.includes("zod.looseObject("), false);
    assert.equal((patched.match(/zod\.object\(/g) ?? []).length, 4);
  });
});

test("fails with actionable Orval output-format guidance when no marker exists", async () => {
  await withTemporaryFile(
    "const schema = z.object({ id: z.string() });\n",
    async (filePath) => {
      assert.throws(
        () => patchGeneratedZod(filePath),
        (error: unknown) => {
          assert(error instanceof Error);
          assert.match(
            error.message,
            /contains no 'zod\.looseObject\(' markers/,
          );
          assert.match(error.message, /Orval's output format may have changed/);
          assert.match(
            error.message,
            /update scripts\/patch-generated-zod\.ts before regenerating/,
          );
          return true;
        },
      );
    },
  );
});

test("explains how to fix a missing generated Zod output path", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "patch-generated-zod-missing-"),
  );
  const missingFilePath = join(directory, "generated", "api.ts");

  try {
    assert.throws(
      () => patchGeneratedZod(missingFilePath),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /Generated Zod output is missing/);
        assert.match(
          error.message,
          new RegExp(missingFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
        assert.match(
          error.message,
          /Orval may have changed its output path; update the codegen target and post-processing step/,
        );
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
