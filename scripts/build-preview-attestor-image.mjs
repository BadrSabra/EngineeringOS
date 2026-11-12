import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewBuilderContext } from "./build-preview-builder-image.mjs";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contextPrefix = path.join(os.tmpdir(), "engineeringos-preview-attestor-");

function parseArguments(args) {
  const options = {
    nodeBaseImage: "",
    tag: "engineeringos-preview-attestor:local",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--node-base-image") {
      options.nodeBaseImage = args[++index] ?? "";
    } else if (argument === "--tag") {
      options.tag = args[++index] ?? "";
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/build-preview-attestor-image.mjs --node-base-image node:TAG@sha256:DIGEST [--tag NAME]\n",
      );
      process.exit(0);
    } else {
      throw new Error("Invalid Attestor image build arguments.");
    }
  }
  if (
    !/^(?:node|docker\.io\/library\/node):[\w.-]+@sha256:[a-f0-9]{64}$/i.test(
      options.nodeBaseImage,
    ) ||
    !/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(options.tag)
  ) {
    throw new Error(
      "A digest-pinned Node image and valid local tag are required.",
    );
  }
  return options;
}

async function copyRegularFile(source, destination) {
  const stats = await lstat(source);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Attestor image context contains an unsupported file.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function createPreviewAttestorContext() {
  const contextRoot = await createPreviewBuilderContext();
  try {
    const attestorRoot = path.join(workspaceRoot, "infra/aws-preview/attestor");
    const contextAttestorRoot = path.join(
      contextRoot,
      "infra/aws-preview/attestor",
    );
    for (const file of [
      "package.json",
      "Dockerfile",
      "attest.mjs",
      "receipt.mjs",
    ]) {
      await copyRegularFile(
        path.join(attestorRoot, file),
        path.join(contextAttestorRoot, file),
      );
    }
    return contextRoot;
  } catch (error) {
    await rm(contextRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let contextRoot;
  try {
    contextRoot = await createPreviewAttestorContext();
    const dockerfile = path.join(
      contextRoot,
      "infra/aws-preview/attestor/Dockerfile",
    );
    const result = spawnSync(
      "docker",
      [
        "build",
        "--file",
        dockerfile,
        "--build-arg",
        `NODE_BASE_IMAGE=${options.nodeBaseImage}`,
        "--tag",
        options.tag,
        contextRoot,
      ],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    process.stdout.write(`Built local image ${options.tag}\n`);
  } finally {
    if (contextRoot) {
      await rm(contextRoot, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch(() => {
    process.stderr.write("Preview Attestor image build failed.\n");
    process.exitCode = 1;
  });
}
