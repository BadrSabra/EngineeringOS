import { describe, expect, it } from "vitest";
import {
  assertPreviewSessionTransition,
  PreviewSessionTransitionError,
  type PreviewSessionStatus,
} from "./preview-session-state.js";

describe("Preview session lifecycle", () => {
  it("allows only forward transitions through startup, ready, and shutdown", () => {
    const allowed: Array<[PreviewSessionStatus, PreviewSessionStatus]> = [
      ["starting", "ready"],
      ["starting", "stopping"],
      ["starting", "failed"],
      ["starting", "expired"],
      ["ready", "stopping"],
      ["ready", "failed"],
      ["ready", "expired"],
      ["stopping", "stopped"],
      ["stopping", "failed"],
      ["stopping", "expired"],
    ];

    for (const [from, to] of allowed) {
      expect(() => assertPreviewSessionTransition(from, to)).not.toThrow();
    }
  });

  it("does not reopen terminal sessions or skip the stopping boundary", () => {
    const forbidden: Array<[PreviewSessionStatus, PreviewSessionStatus]> = [
      ["ready", "starting"],
      ["ready", "stopped"],
      ["stopping", "ready"],
      ["stopped", "ready"],
      ["failed", "starting"],
      ["expired", "ready"],
    ];

    for (const [from, to] of forbidden) {
      expect(() => assertPreviewSessionTransition(from, to)).toThrow(
        PreviewSessionTransitionError,
      );
    }
  });
});
