import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  createFixedViteInvocation,
  runPreviewBuild,
  verifyPreviewBuildCssPolicy,
} from "./build.mjs";
import {
  createPreviewStaticArchive,
  parsePreviewBuildInputArchive,
} from "./archive.mjs";
import { ALLOWED_BUILDER_DEPENDENCIES } from "./profile.mjs";
import { parsePreviewStaticArchive } from "../runtime/server.mjs";

const buildId = "01234567-89ab-42cd-8abc-0123456789ab";
const signingKeys = generateKeyPairSync("ed25519");
const buildJobSigningDomain = Buffer.from(
  "EngineeringOS Preview Build Job v2\n",
  "utf8",
);
const buildJobFields = [
  "version",
  "action",
  "jobId",
  "buildId",
  "builderProfile",
  "builderImageDigest",
  "projectId",
  "proposalId",
  "operationId",
  "proposalRevision",
  "candidateRevision",
  "changeSetHash",
  "sourceRoot",
  "sourceDigest",
  "inputArtifactKey",
  "archiveDigest",
  "outputArtifactKey",
  "attemptId",
  "idempotencyKey",
  "dispatchGeneration",
  "issuedAt",
  "expiresAt",
];
const identity = {
  builderProfile: "vite-react-static-v1",
  projectId: "project-1",
  proposalId: "proposal-1",
  operationId: "operation-1",
  proposalRevision: 3,
  candidateRevision: "a".repeat(64),
  changeSetHash: "b".repeat(64),
  sourceRoot: "web",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content);
    const method = entry.method ?? 0;
    const compressed =
      method === 8 ? deflateRawSync(content) : Buffer.from(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, compressed]);
    localRecords.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.mode ?? 0o100644) * 65_536, 38);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }

  const localBytes = Buffer.concat(localRecords);
  const centralBytes = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, end]);
}

function createBuildInput(options = {}) {
  const sourceRoot = options.sourceRoot ?? identity.sourceRoot;
  const sourceFiles = options.files ?? [
    {
      path: "web/index.html",
      content:
        '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    },
    {
      path: "web/src/main.tsx",
      content: "import React from 'react';\n",
    },
    {
      path: "web/src/index.css",
      content:
        "@import url('https://fonts.googleapis.com/css2?family=Example');\n@import 'tailwindcss';\n@plugin '@tailwindcss/typography';\n",
    },
    {
      path: "web/package.json",
      content: JSON.stringify({
        scripts: {
          build: "node -e \"require('fs').writeFileSync('/tmp/ran','yes')\"",
          postinstall:
            "node -e \"require('fs').writeFileSync('/tmp/ran','yes')\"",
        },
      }),
    },
  ];
  const files = sourceFiles
    .map(({ path: filePath, content }) => {
      const bytes = Buffer.from(content);
      return {
        path: filePath,
        size: bytes.length,
        sha256: sha256(bytes),
        content: bytes,
      };
    })
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  const manifestFiles = files.map(
    ({ path: filePath, size, sha256: digest }) => ({
      path: filePath,
      size,
      sha256: digest,
    }),
  );
  const manifest = {
    version: 1,
    ...identity,
    sourceRoot,
    sourceDigest: sha256(JSON.stringify({ sourceRoot, files: manifestFiles })),
    files: manifestFiles,
  };
  const entries = [
    ...files.map((file) => ({
      name: file.path,
      content: file.content,
      method: 8,
    })),
    {
      name: "engineeringos-preview-manifest.json",
      content: JSON.stringify(manifest),
      method: 8,
    },
  ];
  const archive = makeZip(entries);
  const binding = {
    builderProfile: manifest.builderProfile,
    projectId: manifest.projectId,
    proposalId: manifest.proposalId,
    operationId: manifest.operationId,
    proposalRevision: manifest.proposalRevision,
    candidateRevision: manifest.candidateRevision,
    changeSetHash: manifest.changeSetHash,
    sourceRoot: manifest.sourceRoot,
    sourceDigest: manifest.sourceDigest,
  };
  return { archive, binding, manifest, entries };
}

function signedUrl(objectKey, signedHeaders) {
  const bucket = "preview-builds-example";
  const region = "us-east-1";
  const url = new URL(
    `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`,
  );
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set(
    "X-Amz-Credential",
    `ASIAEXAMPLEACCESS/20261111/${region}/s3/aws4_request`,
  );
  url.searchParams.set("X-Amz-Date", "20261111T120000Z");
  url.searchParams.set("X-Amz-Expires", "300");
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);
  url.searchParams.set("X-Amz-Signature", "c".repeat(64));
  url.searchParams.set("X-Amz-Security-Token", "temporary-session-token");
  return url.toString();
}

function jobEnvironment(input) {
  const inputDigest = sha256(input.archive);
  const identityDigest = sha256(
    JSON.stringify({
      projectId: input.binding.projectId,
      proposalId: input.binding.proposalId,
      operationId: input.binding.operationId,
      proposalRevision: input.binding.proposalRevision,
      candidateRevision: input.binding.candidateRevision,
      changeSetHash: input.binding.changeSetHash,
      sourceDigest: input.binding.sourceDigest,
    }),
  );
  const now = new Date();
  const claims = {
    version: 2,
    action: "preview-build",
    jobId: "11234567-89ab-42cd-8abc-0123456789ab",
    buildId,
    builderProfile: input.binding.builderProfile,
    builderImageDigest: `sha256:${"e".repeat(64)}`,
    projectId: input.binding.projectId,
    proposalId: input.binding.proposalId,
    operationId: input.binding.operationId,
    proposalRevision: input.binding.proposalRevision,
    candidateRevision: input.binding.candidateRevision,
    changeSetHash: input.binding.changeSetHash,
    sourceRoot: input.binding.sourceRoot,
    sourceDigest: input.binding.sourceDigest,
    inputArtifactKey: `build-inputs/${identityDigest}/${inputDigest}.zip`,
    archiveDigest: inputDigest,
    outputArtifactKey: `preview-build-outputs/${buildId}/site.tar.gz`,
    attemptId: "11234567-89ab-42cd-8abc-0123456789ab",
    idempotencyKey: "21234567-89ab-42cd-8abc-0123456789ab",
    dispatchGeneration: 1,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const payload = Buffer.from(
    JSON.stringify(
      Object.fromEntries(buildJobFields.map((field) => [field, claims[field]])),
    ),
  );
  const signature = signBytes(
    null,
    Buffer.concat([buildJobSigningDomain, payload]),
    signingKeys.privateKey,
  );
  return {
    PREVIEW_S3_BUCKET: "preview-builds-example",
    AWS_REGION: "us-east-1",
    PREVIEW_BUILD_JOB_TOKEN: `${payload.toString("base64url")}.${signature.toString("base64url")}`,
    PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM: signingKeys.publicKey.export({
      type: "spki",
      format: "pem",
    }),
    PREVIEW_BUILD_INPUT_URL: signedUrl(
      `build-inputs/${identityDigest}/${inputDigest}.zip`,
      "host",
    ),
    PREVIEW_BUILD_OUTPUT_URL: signedUrl(
      `preview-build-outputs/${buildId}/site.tar.gz`,
      "host;if-none-match",
    ),
  };
}

test("accepts only the exact manifest-bound source root and file set", () => {
  const input = createBuildInput();
  const parsed = parsePreviewBuildInputArchive(input.archive, input.binding);
  assert.equal(parsed.manifest.sourceRoot, "web");
  assert.equal(
    parsed.files.get("web/index.html").toString(),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  assert.equal(parsed.files.size, input.manifest.files.length);
});

test("rejects a ZIP traversal entry and an archive altered after its digest", () => {
  const input = createBuildInput();
  const traversal = makeZip([
    { name: "../escape.txt", content: "no", mode: 0o100644 },
    ...input.entries,
  ]);
  assert.throws(() => parsePreviewBuildInputArchive(traversal, input.binding), {
    code: "PREVIEW_BUILD_INPUT_UNSAFE",
  });

  const altered = Buffer.from(input.archive);
  altered[35] ^= 0xff;
  assert.throws(
    () => parsePreviewBuildInputArchive(altered, input.binding),
    /invalid or unavailable/,
  );
});

test("rejects ZIP symlinks and a manifest that changes the bound source root", () => {
  const input = createBuildInput();
  const symlinkArchive = makeZip([
    ...input.entries.filter((entry) => entry.name !== "web/index.html"),
    {
      name: "web/index.html",
      content: "<div></div>",
      mode: 0o120777,
    },
  ]);
  assert.throws(
    () => parsePreviewBuildInputArchive(symlinkArchive, input.binding),
    /invalid or unavailable/,
  );

  const tamperedManifest = {
    ...input.manifest,
    sourceRoot: ".",
  };
  const tampered = makeZip([
    ...input.entries.filter(
      (entry) => entry.name !== "engineeringos-preview-manifest.json",
    ),
    {
      name: "engineeringos-preview-manifest.json",
      content: JSON.stringify(tamperedManifest),
    },
  ]);
  assert.throws(() => parsePreviewBuildInputArchive(tampered, input.binding), {
    code: "PREVIEW_BUILD_BINDING_MISMATCH",
  });
});

test("ignores candidate package scripts and uploads only a runtime-valid static archive", async () => {
  const input = createBuildInput();
  const env = jobEnvironment(input);
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "preview-builder-test-"),
  );
  let uploaded;
  let invocation;
  let runnerCalled = false;
  const fetcher = async (url, init) => {
    if (init.method === "GET") return new Response(input.archive);
    assert.equal(init.method, "PUT");
    assert.equal(new Headers(init.headers).get("if-none-match"), "*");
    assert.equal(url.toString(), env.PREVIEW_BUILD_OUTPUT_URL);
    uploaded = Buffer.from(init.body);
    return new Response(null, { status: 200 });
  };
  try {
    const result = await runPreviewBuild({
      env,
      fetcher,
      tempDirectory: tempRoot,
      linkDependencies: async () => undefined,
      runVite: async (options) => {
        runnerCalled = true;
        invocation = createFixedViteInvocation(options);
        assert.equal(
          (await readFile(path.join(options.sourceRoot, "package.json")))
            .length > 0,
          true,
        );
        await mkdir(path.join(options.outputDirectory, "assets"), {
          recursive: true,
        });
        await writeFile(
          path.join(options.outputDirectory, "index.html"),
          "<!doctype html><div>Preview</div>",
        );
        await writeFile(
          path.join(options.outputDirectory, "assets", "app.js"),
          "globalThis.previewReady = true;",
        );
      },
    });
    assert.equal(runnerCalled, true);
    assert.equal(result.action, "preview-build-output-uploaded");
    assert.equal(
      result.outputArtifactKey,
      `preview-build-outputs/${buildId}/site.tar.gz`,
    );
    assert.equal(result.jobId, "11234567-89ab-42cd-8abc-0123456789ab");
    assert.equal(result.builderImageDigest, `sha256:${"e".repeat(64)}`);
    assert.equal(result.sourceDigest, input.manifest.sourceDigest);
    assert.ok(uploaded);
    const outputFiles = parsePreviewStaticArchive(
      uploaded,
      result.outputDigest,
    );
    assert.equal(
      outputFiles.get("index.html").toString(),
      "<!doctype html><div>Preview</div>",
    );
    assert.equal(
      outputFiles.get("assets/app.js").toString(),
      "globalThis.previewReady = true;",
    );
    assert.ok(invocation.args.includes("build"));
    assert.ok(invocation.args.includes("--config"));
    assert.ok(
      invocation.args[invocation.args.indexOf("--config") + 1].endsWith(
        "/vite.config.mjs",
      ),
    );
    assert.equal(invocation.args.includes("npm"), false);
    assert.equal(invocation.args.includes("install"), false);
    assert.equal(
      Object.keys(invocation.env).some((key) =>
        /URL|TOKEN|SECRET|AWS/i.test(key),
      ),
      false,
    );
    assert.equal(JSON.stringify(invocation.env).includes("X-Amz"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runs the fixed Vite build with pinned React and CSS packages", async () => {
  const input = createBuildInput({
    files: [
      {
        path: "web/index.html",
        content:
          '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      },
      {
        path: "web/src/main.tsx",
        content:
          "import React from 'react'; import { createRoot } from 'react-dom/client'; import './index.css'; createRoot(document.getElementById('root')!).render(<main className='prose'>Preview is isolated</main>);",
      },
      {
        path: "web/src/index.css",
        content:
          "@import url('https://fonts.googleapis.com/css?family=Example');\n@import 'tailwindcss';\n@plugin '@tailwindcss/typography';\n",
      },
      { path: "web/package.json", content: '{"scripts":{"build":"false"}}' },
    ],
  });
  const env = jobEnvironment(input);
  let output;
  const fetcher = async (_url, init) => {
    if (init.method === "GET") return new Response(input.archive);
    output = Buffer.from(init.body);
    return new Response(null, { status: 200 });
  };
  const result = await runPreviewBuild({ env, fetcher });
  const files = parsePreviewStaticArchive(output, result.outputDigest);
  assert.match(files.get("index.html").toString(), /assets\/index-/u);
  const css = [...files.entries()]
    .filter(([name]) => name.endsWith(".css"))
    .map(([, content]) => content.toString())
    .join("\n");
  assert.match(css, /\.prose/u);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/u);
});

test("never follows redirects or accepts reusable output objects", async () => {
  const input = createBuildInput();
  await assert.rejects(
    runPreviewBuild({
      env: {
        ...jobEnvironment(input),
        PREVIEW_BUILD_OUTPUT_URL: signedUrl(
          `preview-build-outputs/${buildId}/site.tar.gz`,
          "host",
        ),
      },
      fetcher: async () => {
        throw new Error("fetch must not run");
      },
      linkDependencies: async () => undefined,
      verifyCss: async () => undefined,
      runVite: async () => assert.fail("Vite must not run"),
    }),
    { code: "PREVIEW_BUILD_TRANSFER_INVALID" },
  );
});

test("requires a valid API-signed build job before accessing either artifact", async () => {
  const input = createBuildInput();
  const env = jobEnvironment(input);
  const [payload, signature] = env.PREVIEW_BUILD_JOB_TOKEN.split(".");
  const alteredSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  let fetchCalled = false;
  await assert.rejects(
    runPreviewBuild({
      env: {
        ...env,
        PREVIEW_BUILD_JOB_TOKEN: `${payload}.${alteredSignature}`,
        PREVIEW_BUILD_EXPECTED_BINDING_JSON: JSON.stringify({
          ...input.binding,
          projectId: "attacker-project",
        }),
      },
      fetcher: async () => {
        fetchCalled = true;
        throw new Error("invalid job must not access S3");
      },
      linkDependencies: async () => undefined,
      verifyCss: async () => undefined,
      runVite: async () => assert.fail("Vite must not run"),
    }),
    { code: "PREVIEW_BUILD_JOB_INVALID" },
  );
  assert.equal(fetchCalled, false);
});

test("rejects unsupported CSS plugin/config directives before running Vite", async () => {
  const input = createBuildInput({
    files: [
      { path: "web/index.html", content: "<div></div>" },
      {
        path: "web/src/index.css",
        content: "@plugin 'candidate-plugin';",
      },
    ],
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "preview-css-policy-"));
  try {
    await mkdir(path.join(root, "web", "src"), { recursive: true });
    await writeFile(
      path.join(root, "web", "src", "index.css"),
      "@plugin 'candidate-plugin';",
    );
    await assert.rejects(verifyPreviewBuildCssPolicy(root), {
      code: "PREVIEW_BUILD_CSS_POLICY",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(input.manifest.sourceRoot, "web");
});

test("the package dependency set exactly covers the reviewed Dashboard imports", async () => {
  const builder = JSON.parse(
    await readFile(new URL("./package.json", import.meta.url), "utf8"),
  );
  const externalImports = new Set();
  const sourceRoot = new URL(
    "../../../artifacts/dashboard/src/",
    import.meta.url,
  );
  async function visit(directory) {
    const entries = await import("node:fs/promises").then(({ readdir }) =>
      readdir(directory, { withFileTypes: true }),
    );
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (
        /\.(?:tsx?|jsx?)$/u.test(entry.name) &&
        !/\.(?:test|spec)\./u.test(entry.name)
      ) {
        const source = await readFile(absolute, "utf8");
        for (const match of source.matchAll(
          /(?:from\s*|import\s*\()\s*["']([^"']+)["']/gu,
        )) {
          const imported = match[1];
          if (
            imported.startsWith(".") ||
            imported.startsWith("@/") ||
            imported.startsWith("@assets/") ||
            imported.startsWith("@workspace/")
          ) {
            continue;
          }
          externalImports.add(
            imported.startsWith("@")
              ? imported.split("/").slice(0, 2).join("/")
              : imported.split("/")[0],
          );
        }
      }
    }
  }
  await visit(fileURLToPath(sourceRoot));
  assert.deepEqual(
    [...externalImports].filter((name) => !(name in builder.dependencies)),
    [],
  );
  assert.ok(ALLOWED_BUILDER_DEPENDENCIES.includes("tailwindcss"));
});

test("creates a gzip USTAR archive accepted by the deployed static runtime parser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "preview-static-output-"));
  try {
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<main>ok</main>");
    await writeFile(path.join(root, "assets", "app.css"), "body{margin:0}");
    const archive = await createPreviewStaticArchive(root);
    const digest = sha256(archive);
    const files = parsePreviewStaticArchive(archive, digest);
    assert.equal(files.get("index.html").toString(), "<main>ok</main>");
    assert.equal(files.get("assets/app.css").toString(), "body{margin:0}");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
