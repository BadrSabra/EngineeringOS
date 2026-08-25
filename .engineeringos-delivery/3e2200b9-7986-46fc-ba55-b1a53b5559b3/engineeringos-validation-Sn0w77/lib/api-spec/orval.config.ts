import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
// The drift check points codegen at a temporary output root so validation
// never mutates the working tree. Normal codegen keeps the repository root.
const outputRoot = process.env.CODEGEN_OUTPUT_ROOT
  ? path.resolve(process.env.CODEGEN_OUTPUT_ROOT)
  : root;
const apiClientReactSrc = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
);
const apiZodSrc = path.resolve(outputRoot, "lib", "api-zod", "src");
const apiClientReactMutator = path.resolve(
  outputRoot,
  "lib",
  "api-client-react",
  "src",
  "custom-fetch.ts",
);

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// ── Zod post-processing rationale ────────────────────────────────────────────
//
// Orval 8.x generates `z.looseObject(...)` when targeting OpenAPI 3.1 because
// the spec allows additional properties by default in that version. However,
// this codebase uses Zod v3, which has no `looseObject` constructor — it was
// introduced in Zod v4. The `sed` step in package.json replaces every
// `z.looseObject(` with `z.object(` so the generated code compiles cleanly
// against Zod v3. The checked transform lives in
// scripts/patch-generated-zod.ts and fails if Orval no longer emits the
// expected marker.
//
// Important behavioural notes:
//   • `z.object()` in Zod v3 strips unknown keys (strip mode) — extra fields
//     are silently removed, not rejected. This is intentional for response
//     parsing where forward-compatibility matters.
//   • For request bodies on mutation endpoints, `additionalProperties: false`
//     is set in openapi.yaml (PR-04), which is the contract-level signal that
//     extra keys must not be sent. Runtime enforcement (strict mode) can be
//     added per-schema by calling `.strict()` on the generated schema if
//     needed.
//   • The post-processing command verifies that at least one expected
//     `looseObject` marker was transformed, so a future Orval upgrade that
//     changes the output format cannot silently make this step a no-op.
//
// If you upgrade Orval or switch to Zod v4, evaluate whether this sed step
// (and the matching checked transform) can be removed.

export default defineConfig({
  "api-client-react": {
    input: {
      target: path.resolve(__dirname, "openapi.yaml"),
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          // The mutator is source code, not generated output, so it always
          // remains available at the same relative path when output is
          // redirected for the non-mutating drift check.
          path: apiClientReactMutator,
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: path.resolve(__dirname, "openapi.yaml"),
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
