import { describe, expect, it } from "vitest";
import {
  isPreviewBuildOutputArtifactKey,
  previewBuildOutputArtifactKey,
} from "./preview-build-output-key.js";

const buildId = "9c99a591-cf7f-4f18-8c4b-08e53ca1e4aa";

describe("Preview build generation-scoped output keys", () => {
  it("creates a distinct immutable path for each dispatch generation", () => {
    expect(previewBuildOutputArtifactKey(buildId, 1)).toBe(
      `preview-build-outputs/${buildId}/g1/site.tar.gz`,
    );
    expect(previewBuildOutputArtifactKey(buildId, 2)).toBe(
      `preview-build-outputs/${buildId}/g2/site.tar.gz`,
    );
    expect(
      isPreviewBuildOutputArtifactKey(
        previewBuildOutputArtifactKey(buildId, 2),
        { buildId, dispatchGeneration: 2 },
      ),
    ).toBe(true);
    expect(
      isPreviewBuildOutputArtifactKey(
        previewBuildOutputArtifactKey(buildId, 1),
        { buildId, dispatchGeneration: 2 },
      ),
    ).toBe(false);
  });

  it("keeps the old unversioned path valid only for generation one", () => {
    const legacyKey = `preview-build-outputs/${buildId}/site.tar.gz`;
    expect(
      isPreviewBuildOutputArtifactKey(legacyKey, {
        buildId,
        dispatchGeneration: 1,
      }),
    ).toBe(true);
    expect(
      isPreviewBuildOutputArtifactKey(legacyKey, {
        buildId,
        dispatchGeneration: 2,
      }),
    ).toBe(false);
    expect(
      isPreviewBuildOutputArtifactKey(
        `preview-build-outputs/${buildId}/g2/../site.tar.gz`,
      ),
    ).toBe(false);
  });
});
