import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { hashDeliveryTree } from "./delivery-workspace.js";
import {
  createPreviewBuildInputArchive,
  PreviewBuildInputError,
  type PreviewBuildInputIdentity,
} from "./preview-build-input.js";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "preview-build-input-"));
  roots.push(root);
  return root;
}

function identity(candidateRevision: string): PreviewBuildInputIdentity {
  return {
    projectId: "project-1",
    proposalId: "proposal-1",
    operationId: "operation-1",
    proposalRevision: 2,
    candidateRevision,
    changeSetHash: "b".repeat(64),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createPreviewBuildInputArchive", () => {
  it("packages the exact stable Candidate and omits excluded runtime data", async () => {
    const root = await createRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "private-package"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "package.json"),
      '{"scripts":{"build":"vite build"}}\n',
    );
    await writeFile(
      path.join(root, "src", "main.tsx"),
      "export const value = 1;\n",
    );
    await writeFile(
      path.join(root, "node_modules", "private-package", "index.js"),
      "ignored",
    );
    const candidateRevision = await hashDeliveryTree(root);

    const result = await createPreviewBuildInputArchive({
      workspaceRoot: root,
      sourceRoot: ".",
      identity: identity(candidateRevision),
    });
    const zip = new AdmZip(result.archive);
    const manifest = JSON.parse(
      zip
        .getEntry("engineeringos-preview-manifest.json")!
        .getData()
        .toString("utf8"),
    );

    expect(zip.getEntry("package.json")?.getData().toString("utf8")).toContain(
      '"build":"vite build"',
    );
    expect(zip.getEntry("src/main.tsx")?.getData().toString("utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(zip.getEntry("node_modules/private-package/index.js")).toBeNull();
    expect(manifest).toMatchObject({
      version: 1,
      builderProfile: "vite-react-static-v1",
      projectId: "project-1",
      proposalId: "proposal-1",
      proposalRevision: 2,
      candidateRevision,
      changeSetHash: "b".repeat(64),
    });
    expect(manifest.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.archiveDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the server-selected source root into the source digest", async () => {
    const root = await createRoot();
    await mkdir(path.join(root, "web"), { recursive: true });
    await writeFile(path.join(root, "index.html"), "<main>root</main>");
    await writeFile(path.join(root, "web", "index.html"), "<main>web</main>");
    const candidateRevision = await hashDeliveryTree(root);

    const rootBuild = await createPreviewBuildInputArchive({
      workspaceRoot: root,
      sourceRoot: ".",
      identity: identity(candidateRevision),
    });
    const webBuild = await createPreviewBuildInputArchive({
      workspaceRoot: root,
      sourceRoot: "web",
      identity: identity(candidateRevision),
    });

    expect(rootBuild.manifest.sourceDigest).not.toBe(
      webBuild.manifest.sourceDigest,
    );
    expect(rootBuild.manifest.sourceRoot).toBe(".");
    expect(webBuild.manifest.sourceRoot).toBe("web");
  });

  it.each(["../outside", "/absolute", "web\\nested"])(
    "rejects unsafe source-root path %s",
    async (sourceRoot) => {
      const root = await createRoot();
      const candidateRevision = await hashDeliveryTree(root);
      await expect(
        createPreviewBuildInputArchive({
          workspaceRoot: root,
          sourceRoot,
          identity: identity(candidateRevision),
        }),
      ).rejects.toMatchObject({
        code: "PREVIEW_BUILD_INPUT_INVALID",
      });
    },
  );

  it("rejects a Candidate whose persisted hash no longer matches", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "index.html"), "<main>old</main>");

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity("a".repeat(64)),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_INPUT_CHANGED",
    });
  });

  it("rejects sensitive configuration before any archive is returned", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "package.json"), "{}");
    await writeFile(
      path.join(root, ".env.production"),
      "TOKEN=should-not-transfer",
    );
    await writeFile(path.join(root, ".env.example"), "TOKEN=maybe-placeholder");
    await writeFile(path.join(root, ".envrc"), "export TOKEN=hidden");
    await writeFile(path.join(root, "id_ed25519"), "private-key");
    const candidateRevision = await hashDeliveryTree(root);

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
      }),
    ).rejects.toBeInstanceOf(PreviewBuildInputError);
    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_INPUT_SENSITIVE",
    });
  });

  it("rejects recognizable credentials in ordinary source files without echoing them", async () => {
    const root = await createRoot();
    const fakeCredential = `ghp_${"a".repeat(36)}`;
    await writeFile(
      path.join(root, "src-config.ts"),
      `export const clientToken = "${fakeCredential}";\n`,
    );
    const candidateRevision = await hashDeliveryTree(root);

    const error = await createPreviewBuildInputArchive({
      workspaceRoot: root,
      sourceRoot: ".",
      identity: identity(candidateRevision),
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "PREVIEW_BUILD_INPUT_SECRET",
    });
    expect(String(error)).not.toContain(fakeCredential);
  });

  it("allows environment references and obvious placeholders", async () => {
    const root = await createRoot();
    await writeFile(
      path.join(root, "src-config.ts"),
      'export const clientToken = process.env.CLIENT_TOKEN;\nexport const apiKey = "your-value";\n',
    );
    const candidateRevision = await hashDeliveryTree(root);

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
      }),
    ).resolves.toMatchObject({
      manifest: {
        candidateRevision,
      },
    });
  });

  it("rejects symlinks instead of following them into another tree", async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(path.join(outside, "secret.txt"), "not candidate content");
    await symlink(outside, path.join(root, "linked"));
    const candidateRevision = await hashDeliveryTree(root);

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_INPUT_UNSAFE",
    });
  });

  it("enforces byte limits while reading the pinned Candidate", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "index.html"), "12345");
    const candidateRevision = await hashDeliveryTree(root);

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
        limits: { maxTotalBytes: 4 },
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_INPUT_LIMIT",
    });
  });

  it("rejects cross-platform path aliases", async () => {
    const root = await createRoot();
    await writeFile(path.join(root, "bad\\path.txt"), "no");
    const candidateRevision = await hashDeliveryTree(root);

    await expect(
      createPreviewBuildInputArchive({
        workspaceRoot: root,
        sourceRoot: ".",
        identity: identity(candidateRevision),
      }),
    ).rejects.toMatchObject({
      code: "PREVIEW_BUILD_INPUT_UNSAFE",
    });
  });
});
