import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildProjectFileManifest,
  buildProjectFileSources,
} from "../filesystem-manifest.js";

describe("filesystem manifest", () => {
  it("builds a verified bounded inventory and skips ignored directories and symlinks", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-filesystem-manifest-"));
    const outsidePath = await fs.mkdtemp(path.join(tmpdir(), "eos-filesystem-outside-"));
    try {
      await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
      await fs.mkdir(path.join(rootPath, "node_modules", "ignored"), { recursive: true });
      await fs.mkdir(path.join(rootPath, ".git"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "package.json"), '{"name":"manifest-fixture"}\n', "utf8");
      await fs.writeFile(path.join(rootPath, "vite.config.ts"), "export default {};\n", "utf8");
      await fs.writeFile(path.join(rootPath, "src", "App.tsx"), "export function App() {}\n", "utf8");
      await fs.writeFile(path.join(rootPath, "node_modules", "ignored", "index.js"), "", "utf8");
      await fs.writeFile(path.join(outsidePath, "outside.ts"), "export const outside = true;\n", "utf8");
      await fs.symlink(path.join(outsidePath, "outside.ts"), path.join(rootPath, "src", "outside.ts"));

      const manifest = await buildProjectFileManifest(rootPath);

      expect(manifest).toMatchObject({
        status: "VERIFIED",
        truncated: false,
        packageManifests: ["package.json"],
        configFiles: ["package.json", "vite.config.ts"],
      });
      expect(manifest.files).toEqual([
        "package.json",
        "src/App.tsx",
        "vite.config.ts",
      ]);
      expect(manifest.directories).toEqual(["src"]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(outsidePath, { recursive: true, force: true });
    }
  });

  it("fails closed for a missing root and a non-directory root", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-filesystem-missing-"));
    const filePath = path.join(rootPath, "file.txt");
    await fs.writeFile(filePath, "not a directory", "utf8");

    try {
      await expect(buildProjectFileManifest(path.join(rootPath, "missing"))).resolves.toMatchObject({
        status: "UNAVAILABLE",
        files: [],
        directories: [],
      });
      await expect(buildProjectFileManifest(filePath)).resolves.toMatchObject({
        status: "UNAVAILABLE",
        files: [],
        directories: [],
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reads only verified source files and reports source truncation", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-filesystem-sources-"));
    try {
      await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "src", "app.ts"), "export const app = true;\n", "utf8");
      const longContent = "x".repeat(8_000);
      await fs.writeFile(path.join(rootPath, "src", "long.ts"), longContent, "utf8");

      const manifest = await buildProjectFileManifest(rootPath);
      const sources = await buildProjectFileSources(rootPath, manifest, "app");

      expect(sources.status).toBe("VERIFIED");
      expect(sources.files.map((file) => file.path)).toEqual(["src/app.ts", "src/long.ts"]);
      expect(sources.files[0]).toMatchObject({ path: "src/app.ts", truncated: false });
      expect(sources.files[1]).toMatchObject({
        path: "src/long.ts",
        truncated: true,
      });
      expect(sources.files[1]?.content).toHaveLength(7_000);
      expect(sources.truncated).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});