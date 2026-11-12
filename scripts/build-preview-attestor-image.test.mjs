import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPreviewAttestorContext } from "./build-preview-attestor-image.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("stages only pinned Attestor sources and required workspace manifests", async () => {
  const contextRoot = await createPreviewAttestorContext();
  try {
    const packageManifest = JSON.parse(
      await readFile(
        path.join(contextRoot, "infra/aws-preview/attestor/package.json"),
        "utf8",
      ),
    );
    assert.equal(packageManifest.name, "@workspace/preview-attestor");
    await access(
      path.join(contextRoot, "infra/aws-preview/attestor/attest.mjs"),
    );
    await access(
      path.join(contextRoot, "infra/aws-preview/builder/job-contract.mjs"),
    );
    const dockerfile = await readFile(
      path.join(contextRoot, "infra/aws-preview/attestor/Dockerfile"),
      "utf8",
    );
    assert.match(dockerfile, /\/app\/infra\/aws-preview\/attestor\//u);
    assert.match(
      dockerfile,
      /builder\/job-contract\.mjs \/app\/infra\/aws-preview\/builder\/job-contract\.mjs/u,
    );
    assert.match(
      dockerfile,
      /ENTRYPOINT \["node", "\/app\/infra\/aws-preview\/attestor\/attest\.mjs"\]/u,
    );
    await access(path.join(contextRoot, "pnpm-lock.yaml"));
    await assert.rejects(
      access(path.join(contextRoot, "artifacts/api-server/src/index.ts")),
    );
    await assert.rejects(access(path.join(contextRoot, ".env")));
  } finally {
    await rm(contextRoot, { recursive: true, force: true });
  }
});

test("pins Corepack to the workspace pnpm release in both containers", async () => {
  for (const container of ["builder", "attestor"]) {
    const dockerfile = await readFile(
      path.join(workspaceRoot, `infra/aws-preview/${container}/Dockerfile`),
      "utf8",
    );
    assert.match(dockerfile, /ARG PNPM_VERSION=10\.26\.1/u);
    assert.match(
      dockerfile,
      /corepack enable && corepack prepare pnpm@\$\{PNPM_VERSION\} --activate/u,
    );
  }
});
