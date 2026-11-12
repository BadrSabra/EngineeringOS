import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILDER_PROFILE,
  ALLOWED_BUILDER_DEPENDENCIES,
  MAX_INPUT_ARCHIVE_BYTES,
} from "./profile.mjs";
import {
  createPreviewStaticArchive,
  extractPreviewBuildFiles,
  parsePreviewBuildInputArchive,
} from "./archive.mjs";
import { verifyPreviewBuildJobToken } from "./job-contract.mjs";
import postcss from "postcss";

const INPUT_KEY = /^build-inputs\/([a-f0-9]{64})\/([a-f0-9]{64})\.zip$/i;
const OUTPUT_KEY =
  /^preview-build-outputs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/site\.tar\.gz$/i;
const HASH = /^[a-f0-9]{64}$/i;
const MAX_URL_TTL_SECONDS = 300;
const BUILD_TIMEOUT_MS = 120_000;

const builderDirectory = path.dirname(fileURLToPath(import.meta.url));

export class PreviewBuildExecutionError extends Error {
  constructor(code) {
    super("Preview build failed or is unavailable.");
    this.name = "PreviewBuildExecutionError";
    this.code = code;
  }
}

function fail(code) {
  throw new PreviewBuildExecutionError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireText(value, maxLength = 255) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    fail("PREVIEW_BUILD_ENV_INVALID");
  }
  return value;
}

function expectedS3Host(bucket, region) {
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `${bucket}.s3.${region}.${suffix}`;
}

function validateSignedObjectUrl(value, options) {
  let url;
  try {
    if (typeof value !== "string" || value.length > 8_192) {
      fail("PREVIEW_BUILD_TRANSFER_INVALID");
    }
    url = new URL(value);
  } catch {
    fail("PREVIEW_BUILD_TRANSFER_INVALID");
  }
  const queryNames = [...url.searchParams.keys()];
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedS3Host(options.bucket, options.region) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.pathname.slice(1) !== options.objectKey ||
    new Set(queryNames).size !== queryNames.length ||
    url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
    !/^[a-f0-9]{64}$/i.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
    !/^[A-Z0-9-]+\/[0-9]{8}\/[a-z0-9-]+\/s3\/aws4_request$/i.test(
      url.searchParams.get("X-Amz-Credential") ?? "",
    )
  ) {
    fail("PREVIEW_BUILD_TRANSFER_INVALID");
  }
  const ttl = Number(url.searchParams.get("X-Amz-Expires"));
  const signedHeaders = url.searchParams
    .get("X-Amz-SignedHeaders")
    ?.toLowerCase()
    .split(";");
  if (
    !Number.isInteger(ttl) ||
    ttl < 1 ||
    ttl > MAX_URL_TTL_SECONDS ||
    !signedHeaders?.includes("host") ||
    (options.method === "PUT" && !signedHeaders.includes("if-none-match"))
  ) {
    fail("PREVIEW_BUILD_TRANSFER_INVALID");
  }
  return url;
}

function validateJobEnvironment(env) {
  const bucket = requireText(env.PREVIEW_S3_BUCKET, 63);
  const region = requireText(env.AWS_REGION, 32);
  const token = requireText(env.PREVIEW_BUILD_JOB_TOKEN, 8_192);
  const publicKeyPem = env.PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM;
  if (
    typeof publicKeyPem !== "string" ||
    publicKeyPem.length > 16_384 ||
    !publicKeyPem.includes("-----BEGIN")
  ) {
    fail("PREVIEW_BUILD_JOB_INVALID");
  }
  let job;
  try {
    job = verifyPreviewBuildJobToken(token, publicKeyPem);
  } catch {
    fail("PREVIEW_BUILD_JOB_INVALID");
  }
  const buildId = job.buildId;
  const inputKey = job.inputArtifactKey;
  const inputDigest = job.archiveDigest;
  const outputKey = job.outputArtifactKey;
  const inputMatch = INPUT_KEY.exec(inputKey);
  const outputMatch = OUTPUT_KEY.exec(outputKey);
  const expectedBinding = {
    builderProfile: job.builderProfile,
    projectId: job.projectId,
    proposalId: job.proposalId,
    operationId: job.operationId,
    proposalRevision: job.proposalRevision,
    candidateRevision: job.candidateRevision,
    changeSetHash: job.changeSetHash,
    sourceRoot: job.sourceRoot,
    sourceDigest: job.sourceDigest,
  };
  const expectedInputBindingDigest = sha256(
    JSON.stringify({
      projectId: expectedBinding.projectId,
      proposalId: expectedBinding.proposalId,
      operationId: expectedBinding.operationId,
      proposalRevision: expectedBinding.proposalRevision,
      candidateRevision: expectedBinding.candidateRevision,
      changeSetHash: expectedBinding.changeSetHash,
      sourceDigest: expectedBinding.sourceDigest,
    }),
  );
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..") ||
    !/^[a-z0-9-]+$/i.test(region) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      buildId,
    ) ||
    !inputMatch ||
    !HASH.test(inputDigest) ||
    inputMatch[1]?.toLowerCase() !== expectedInputBindingDigest ||
    inputMatch[2]?.toLowerCase() !== inputDigest.toLowerCase() ||
    !outputMatch ||
    outputMatch[1]?.toLowerCase() !== buildId.toLowerCase()
  ) {
    fail("PREVIEW_BUILD_ENV_INVALID");
  }
  const inputUrl = validateSignedObjectUrl(env.PREVIEW_BUILD_INPUT_URL, {
    bucket,
    region,
    objectKey: inputKey,
    method: "GET",
  });
  const outputUrl = validateSignedObjectUrl(env.PREVIEW_BUILD_OUTPUT_URL, {
    bucket,
    region,
    objectKey: outputKey,
    method: "PUT",
  });
  return {
    bucket,
    region,
    buildId,
    jobId: job.jobId,
    builderImageDigest: job.builderImageDigest,
    inputKey,
    inputDigest: inputDigest.toLowerCase(),
    outputKey,
    inputUrl,
    outputUrl,
    expectedBinding,
  };
}

async function readResponseBounded(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    fail("PREVIEW_BUILD_INPUT_LIMIT");
  }
  if (!response.body) fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) fail("PREVIEW_BUILD_INPUT_LIMIT");
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof PreviewBuildExecutionError) throw error;
    fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
  if (contentLength !== null && bytes !== Number(contentLength)) {
    fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
  return Buffer.concat(chunks, bytes);
}

async function downloadBuildInput(job, fetcher) {
  let response;
  try {
    response = await fetcher(job.inputUrl, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/zip" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
  if (response.status !== 200) fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  const archive = await readResponseBounded(response, MAX_INPUT_ARCHIVE_BYTES);
  if (sha256(archive) !== job.inputDigest) {
    fail("PREVIEW_BUILD_INPUT_DIGEST_MISMATCH");
  }
  return archive;
}

async function linkAllowlistedDependencies(workspaceRoot) {
  const dependencyRoot = path.join(workspaceRoot, "node_modules");
  await mkdir(dependencyRoot, { recursive: false, mode: 0o700 });
  for (const packageName of ALLOWED_BUILDER_DEPENDENCIES) {
    const packageParts = packageName.split("/");
    const trustedPackagePath = path.join(
      builderDirectory,
      "node_modules",
      ...packageParts,
    );
    const trustedStats = await lstat(trustedPackagePath).catch(() => null);
    if (!trustedStats) fail("PREVIEW_BUILD_TOOLCHAIN_INVALID");
    const linkPath = path.join(dependencyRoot, ...packageParts);
    await mkdir(path.dirname(linkPath), { recursive: true, mode: 0o700 });
    await symlink(trustedPackagePath, linkPath, "dir");
  }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function verifyPreviewBuildCssPolicy(workspaceRoot) {
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".css")) {
        continue;
      }
      const source = await readFile(absolute, "utf8");
      let parsed;
      try {
        parsed = postcss.parse(source, { from: absolute });
      } catch {
        fail("PREVIEW_BUILD_CSS_POLICY");
      }
      parsed.walkAtRules((rule) => {
        const name = rule.name.toLowerCase();
        if (["config", "source", "reference"].includes(name)) {
          fail("PREVIEW_BUILD_CSS_POLICY");
        }
        if (name === "plugin") {
          const pluginName = rule.params.trim().replace(/^['"]|['"]$/g, "");
          if (pluginName !== "@tailwindcss/typography") {
            fail("PREVIEW_BUILD_CSS_POLICY");
          }
        }
        if (name === "import") {
          const importName = rule.params.trim().replace(/^['"]|['"]$/g, "");
          if (
            importName !== "tailwindcss" &&
            importName !== "tw-animate-css" &&
            !importName.startsWith("./") &&
            !importName.startsWith("../") &&
            !/(?:https?:|file:|\/\/|url\s*\()/iu.test(rule.params)
          ) {
            fail("PREVIEW_BUILD_CSS_POLICY");
          }
          if (
            (importName.startsWith("./") || importName.startsWith("../")) &&
            !inside(
              workspaceRoot,
              path.resolve(path.dirname(absolute), importName),
            )
          ) {
            fail("PREVIEW_BUILD_CSS_POLICY");
          }
        }
      });
    }
  }
  await visit(workspaceRoot);
}

export function createFixedViteInvocation(options) {
  const viteEntrypoint = path.join(
    builderDirectory,
    "node_modules",
    "vite",
    "bin",
    "vite.js",
  );
  const configPath = path.join(builderDirectory, "vite.config.mjs");
  const childEnv = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: options.homeDirectory,
    TMPDIR: options.tempDirectory,
    NODE_ENV: "production",
    PREVIEW_BUILDER_TEMP_ROOT: options.tempDirectory,
    PREVIEW_BUILDER_WORKSPACE_ROOT: options.workspaceRoot,
    PREVIEW_BUILDER_SOURCE_ROOT: options.sourceRoot,
    PREVIEW_BUILDER_OUTPUT_DIR: options.outputDirectory,
  };
  return {
    executable: process.execPath,
    args: [
      viteEntrypoint,
      "build",
      options.sourceRoot,
      "--config",
      configPath,
      "--logLevel",
      "silent",
    ],
    cwd: builderDirectory,
    env: childEnv,
  };
}

async function runFixedVite(options) {
  const invocation = createFixedViteInvocation(options);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: "ignore",
      detached: true,
    });
    let settled = false;
    let forceKill;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // The child may already have exited.
      }
      forceKill = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The child process group may already be gone.
        }
      }, 2_000);
      forceKill.unref();
      reject(new PreviewBuildExecutionError("PREVIEW_BUILD_TIMEOUT"));
    }, BUILD_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (settled) return;
      settled = true;
      reject(new PreviewBuildExecutionError("PREVIEW_BUILD_EXECUTION_FAILED"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else
        reject(
          new PreviewBuildExecutionError("PREVIEW_BUILD_EXECUTION_FAILED"),
        );
    });
  });
}

async function uploadBuildOutput(job, archive, fetcher) {
  const outputDigest = sha256(archive);
  let response;
  try {
    response = await fetcher(job.outputUrl, {
      method: "PUT",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      headers: {
        "content-type": "application/gzip",
        "if-none-match": "*",
      },
      body: archive,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
  if (response.status === 412 || response.status === 409) {
    fail("PREVIEW_BUILD_OUTPUT_CONFLICT");
  }
  if (response.status !== 200 && response.status !== 204) {
    fail("PREVIEW_BUILD_TRANSFER_UNAVAILABLE");
  }
  return outputDigest;
}

export async function runPreviewBuild({
  env = process.env,
  fetcher = fetch,
  runVite = runFixedVite,
  linkDependencies = linkAllowlistedDependencies,
  verifyCss = verifyPreviewBuildCssPolicy,
  tempDirectory = os.tmpdir(),
} = {}) {
  const job = validateJobEnvironment(env);
  const inputArchive = await downloadBuildInput(job, fetcher);
  const verified = parsePreviewBuildInputArchive(
    inputArchive,
    job.expectedBinding,
  );
  const workingDirectory = await mkdtemp(
    path.join(tempDirectory, "engineeringos-preview-build-"),
  );
  const workspaceRoot = path.join(workingDirectory, "workspace");
  const homeDirectory = path.join(workingDirectory, "home");
  const outputDirectory = path.join(workingDirectory, "dist");
  const sourceRoot =
    verified.manifest.sourceRoot === "."
      ? workspaceRoot
      : path.resolve(workspaceRoot, ...verified.manifest.sourceRoot.split("/"));
  if (!inside(workspaceRoot, sourceRoot)) {
    await rm(workingDirectory, { recursive: true, force: true });
    fail("PREVIEW_BUILD_SOURCE_ROOT_INVALID");
  }

  try {
    await extractPreviewBuildFiles(verified.files, workspaceRoot);
    await mkdir(homeDirectory, { recursive: true, mode: 0o700 });
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await linkDependencies(workspaceRoot);
    await verifyCss(workspaceRoot);
    await runVite({
      builderDirectory,
      homeDirectory,
      outputDirectory,
      sourceRoot,
      tempDirectory: workingDirectory,
      workspaceRoot,
    });
    const outputArchive = await createPreviewStaticArchive(outputDirectory);
    const outputDigest = await uploadBuildOutput(job, outputArchive, fetcher);
    return {
      action: "preview-build-output-uploaded",
      jobId: job.jobId,
      buildId: job.buildId,
      builderImageDigest: job.builderImageDigest,
      outputArtifactKey: job.outputKey,
      outputDigest,
      outputBytes: outputArchive.length,
      sourceDigest: verified.manifest.sourceDigest,
    };
  } catch (error) {
    if (error instanceof PreviewBuildExecutionError) throw error;
    if (error?.code?.startsWith?.("PREVIEW_BUILD_")) throw error;
    fail("PREVIEW_BUILD_EXECUTION_FAILED");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const result = await runPreviewBuild();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code =
      error instanceof PreviewBuildExecutionError
        ? error.code
        : "PREVIEW_BUILD_FAILED";
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
