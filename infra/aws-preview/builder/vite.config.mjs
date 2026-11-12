import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import postcss from "postcss";
import { defineConfig } from "vite";
import {
  ALLOWED_APPLICATION_PACKAGES,
  ALLOWED_CSS_TOOL_PACKAGES,
  ALLOWED_WORKSPACE_IMPORTS,
} from "./profile.mjs";

const builderDirectory = path.dirname(fileURLToPath(import.meta.url));
const allowedPackages = new Set(ALLOWED_APPLICATION_PACKAGES);
const allowedCssPackages = new Set(ALLOWED_CSS_TOOL_PACKAGES);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function resolveWorkspaceImport(source, workspaceRoot, sourceRoot) {
  if (source.startsWith("@/")) {
    return path.resolve(sourceRoot, "src", source.slice(2));
  }
  if (source.startsWith("@assets/")) {
    return path.resolve(workspaceRoot, "attached_assets", source.slice(8));
  }
  const relativePath = ALLOWED_WORKSPACE_IMPORTS[source];
  return relativePath ? path.resolve(workspaceRoot, relativePath) : null;
}

function candidateBoundaryPlugin(workspaceRoot, sourceRoot) {
  return {
    name: "preview-candidate-boundary",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || importer.startsWith("\0")) return null;
      const normalizedImporter = importer.split("?")[0];
      if (normalizedImporter.startsWith("file://")) {
        const importerPath = fileURLToPath(normalizedImporter);
        if (!inside(workspaceRoot, importerPath)) return null;
      } else if (!path.isAbsolute(normalizedImporter)) {
        return null;
      } else if (!inside(workspaceRoot, normalizedImporter)) {
        return null;
      }
      if (normalizedImporter.includes(`${path.sep}node_modules${path.sep}`)) {
        return null;
      }

      if (
        builtins.has(source) ||
        source.startsWith("file:") ||
        source.startsWith("http:") ||
        source.startsWith("https:") ||
        source.startsWith("//")
      ) {
        throw new Error("Unsupported external or Node import in Candidate.");
      }

      if (
        source === "vite/modulepreload-polyfill" ||
        source === "vite/preload-helper"
      ) {
        return null;
      }

      const workspaceImport = resolveWorkspaceImport(
        source,
        workspaceRoot,
        sourceRoot,
      );
      if (workspaceImport) {
        if (!inside(workspaceRoot, workspaceImport)) {
          throw new Error("Candidate import escapes the build workspace.");
        }
        return workspaceImport;
      }

      if (source.startsWith("@workspace/")) {
        throw new Error("Unsupported workspace package in Candidate.");
      }

      if (source.startsWith(".") || source.startsWith("/")) {
        const resolved = source.startsWith("/")
          ? path.resolve(sourceRoot, source.slice(1))
          : path.resolve(path.dirname(normalizedImporter), source);
        if (!inside(workspaceRoot, resolved)) {
          throw new Error("Candidate import escapes the build workspace.");
        }
        return null;
      }

      const packageName = source.startsWith("@")
        ? source.split("/").slice(0, 2).join("/")
        : source.split("/")[0];
      const fromCss = normalizedImporter.toLowerCase().endsWith(".css");
      if (
        !allowedPackages.has(packageName) &&
        !(fromCss && allowedCssPackages.has(packageName))
      ) {
        throw new Error(
          `Candidate imports a package outside the Builder allowlist: ${packageName}.`,
        );
      }
      return null;
    },
    transform(code, id) {
      if (!id.split("?")[0].toLowerCase().endsWith(".css")) return null;
      const root = postcss.parse(code, { from: id });
      let changed = false;
      root.walkAtRules((rule) => {
        const name = rule.name.toLowerCase();
        if (["config", "source", "reference"].includes(name)) {
          throw new Error("Candidate CSS uses a disabled Tailwind directive.");
        }
        if (name === "plugin") {
          const pluginName = rule.params.trim().replace(/^['"]|['"]$/g, "");
          if (pluginName !== "@tailwindcss/typography") {
            throw new Error(
              "Candidate CSS uses a plugin outside the allowlist.",
            );
          }
        }
        if (name === "import") {
          const importName = rule.params.trim().replace(/^['"]|['"]$/g, "");
          if (/(?:https?:|file:|\/\/|url\s*\()/iu.test(rule.params)) {
            rule.remove();
            changed = true;
            return;
          }
          if (
            importName !== "tailwindcss" &&
            importName !== "tw-animate-css" &&
            !importName.startsWith("./") &&
            !importName.startsWith("../")
          ) {
            throw new Error("Candidate CSS import is outside the allowlist.");
          }
          if (importName.startsWith(".")) {
            const resolvedImport = path.resolve(
              path.dirname(id.split("?")[0]),
              importName,
            );
            if (!inside(workspaceRoot, resolvedImport)) {
              throw new Error("Candidate CSS import escapes the workspace.");
            }
          }
        }
      });
      return changed ? root.toResult().css : null;
    },
  };
}

const workspaceRoot = path.resolve(
  process.env.PREVIEW_BUILDER_WORKSPACE_ROOT ?? "",
);
const sourceRoot = path.resolve(process.env.PREVIEW_BUILDER_SOURCE_ROOT ?? "");
const outputDirectory = path.resolve(
  process.env.PREVIEW_BUILDER_OUTPUT_DIR ?? "",
);
const tempRoot = path.resolve(process.env.PREVIEW_BUILDER_TEMP_ROOT ?? "");

if (
  !process.env.PREVIEW_BUILDER_WORKSPACE_ROOT ||
  !process.env.PREVIEW_BUILDER_SOURCE_ROOT ||
  !process.env.PREVIEW_BUILDER_OUTPUT_DIR ||
  !process.env.PREVIEW_BUILDER_TEMP_ROOT ||
  !inside(tempRoot, workspaceRoot) ||
  !inside(workspaceRoot, sourceRoot) ||
  !inside(tempRoot, outputDirectory)
) {
  throw new Error("Trusted Builder paths are missing or invalid.");
}

export default defineConfig({
  root: sourceRoot,
  base: "./",
  configFile: false,
  envDir: builderDirectory,
  plugins: [
    candidateBoundaryPlugin(workspaceRoot, sourceRoot),
    react(),
    tailwindcss({ optimize: false }),
  ],
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(sourceRoot, "src"),
      },
      {
        find: "@assets",
        replacement: path.resolve(workspaceRoot, "attached_assets"),
      },
      ...Object.entries(ALLOWED_WORKSPACE_IMPORTS).map(
        ([find, relativePath]) => ({
          find,
          replacement: path.resolve(workspaceRoot, relativePath),
        }),
      ),
    ],
    dedupe: ["react", "react-dom"],
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
      "pk_test_preview_placeholder",
    ),
  },
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
  },
});
