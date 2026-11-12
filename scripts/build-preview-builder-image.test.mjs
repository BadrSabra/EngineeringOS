import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createPreviewBuilderContext } from "./build-preview-builder-image.mjs";

async function walk(directory, baseDirectory = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(baseDirectory, absolute);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolute, baseDirectory)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

test("stages a minimal Builder image context without project source or secrets", async () => {
  const context = await createPreviewBuilderContext();
  try {
    const files = await walk(context);
    assert.ok(files.includes("pnpm-lock.yaml"));
    assert.ok(files.includes("pnpm-workspace.yaml"));
    assert.ok(files.includes("infra/aws-preview/builder/build.mjs"));
    assert.ok(files.includes("infra/aws-preview/builder/vite.config.mjs"));
    assert.ok(files.includes("artifacts/dashboard/package.json"));
    assert.ok(files.includes("lib/api-client-react/package.json"));
    assert.ok(
      files.every(
        (file) =>
          !file.includes("node_modules") &&
          !file.startsWith("attached_assets/") &&
          !file.startsWith(".engineeringos-") &&
          !file.startsWith(".local/") &&
          !file.split("/").at(-1).startsWith(".env"),
      ),
    );
    assert.ok(
      files
        .filter(
          (file) =>
            file !== "package.json" &&
            !file.startsWith("infra/aws-preview/builder/"),
        )
        .every(
          (file) =>
            file.endsWith("/package.json") ||
            ["pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(file),
        ),
    );
  } finally {
    await rm(context, { recursive: true, force: true });
  }
});
