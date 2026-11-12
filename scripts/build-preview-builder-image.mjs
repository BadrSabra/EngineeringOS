import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contextPrefix = path.join(os.tmpdir(), "engineeringos-preview-builder-");
const packageTrees = ["artifacts", "lib"];

function parseArguments(args) {
  const options = {
    nodeBaseImage: "",
    tag: "engineeringos-preview-builder:local",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--node-base-image") {
      options.nodeBaseImage = args[++index] ?? "";
    } else if (argument === "--tag") {
      options.tag = args[++index] ?? "";
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/build-preview-builder-image.mjs --node-base-image node:TAG@sha256:DIGEST [--tag NAME]\n",
      );
      process.exit(0);
    } else {
      throw new Error("Invalid Builder image build arguments.");
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
  const sourceStats = await lstat(source);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error("Builder image context contains an unsupported file.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyPackageManifest(directory, contextRoot) {
  const source = path.join(workspaceRoot, directory, "package.json");
  const exists = await stat(source).then(
    (stats) => stats.isFile(),
    () => false,
  );
  if (exists) {
    await copyRegularFile(
      source,
      path.join(contextRoot, directory, "package.json"),
    );
  }
}

async function copyWorkspaceManifests(contextRoot) {
  for (const tree of packageTrees) {
    const rootPath = path.join(workspaceRoot, tree);
    for (const entry of await readdir(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relative = path.join(tree, entry.name);
      await copyPackageManifest(relative, contextRoot);
      if (tree !== "lib" || entry.name !== "integrations") continue;
      for (const integration of await readdir(path.join(rootPath, entry.name), {
        withFileTypes: true,
      })) {
        if (integration.isDirectory()) {
          await copyPackageManifest(
            path.join(relative, integration.name),
            contextRoot,
          );
        }
      }
    }
  }
  await copyPackageManifest("scripts", contextRoot);
}

async function copyBuilderSources(contextRoot) {
  const sourceRoot = path.join(workspaceRoot, "infra/aws-preview/builder");
  const destinationRoot = path.join(contextRoot, "infra/aws-preview/builder");
  await mkdir(destinationRoot, { recursive: true });

  async function visit(sourceDirectory, destinationDirectory) {
    for (const entry of await readdir(sourceDirectory, {
      withFileTypes: true,
    })) {
      if (entry.name === "node_modules") continue;
      const source = path.join(sourceDirectory, entry.name);
      const destination = path.join(destinationDirectory, entry.name);
      const stats = await lstat(source);
      if (stats.isSymbolicLink()) {
        throw new Error("Builder image context cannot contain symlinks.");
      }
      if (stats.isDirectory()) {
        await mkdir(destination, { recursive: true });
        await visit(source, destination);
      } else if (stats.isFile()) {
        await copyRegularFile(source, destination);
      } else {
        throw new Error("Builder image context contains an unsupported entry.");
      }
    }
  }
  await visit(sourceRoot, destinationRoot);
}

export async function createPreviewBuilderContext() {
  const contextRoot = await mkdtemp(contextPrefix);
  try {
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      await copyRegularFile(
        path.join(workspaceRoot, file),
        path.join(contextRoot, file),
      );
    }
    await copyWorkspaceManifests(contextRoot);
    await copyBuilderSources(contextRoot);
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
    contextRoot = await createPreviewBuilderContext();
    const dockerfile = path.join(
      contextRoot,
      "infra/aws-preview/builder/Dockerfile",
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
    process.stderr.write("Preview Builder image build failed.\n");
    process.exitCode = 1;
  });
}
