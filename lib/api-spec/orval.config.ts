import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// ── PR-05: sed post-processing rationale ────────────────────────────────────
//
// Orval 8.x generates `z.looseObject(...)` when targeting OpenAPI 3.1 because
// the spec allows additional properties by default in that version. However,
// this codebase uses Zod v3, which has no `looseObject` constructor — it was
// introduced in Zod v4. The `sed` step in package.json replaces every
// `z.looseObject(` with `z.object(` so the generated code compiles cleanly
// against Zod v3.
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
//   • The drift check (scripts/check-codegen-drift.ts) verifies no `looseObject`
//     remains in the generated output after the patch, so a future Orval upgrade
//     that drops looseObject will not silently break things.
//
// If you upgrade Orval or switch to Zod v4, evaluate whether this sed step
// (and the matching looseObject-verify in the drift check) can be removed.

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
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
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
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
