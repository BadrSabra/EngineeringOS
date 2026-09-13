import { describe, expect, it } from "vitest";
import {
  parseAiSseDataLine,
  serializeAiSseEvent,
} from "./ai-stream-contract.js";

describe("shared AI SSE wire contract", () => {
  it("serializes one JSON data frame consistently", () => {
    expect(serializeAiSseEvent({ type: "stage", stage: "calling-model" }))
      .toBe('data: {"type":"stage","stage":"calling-model"}\n\n');
  });

  it("rejects malformed JSON and unknown event types at the shared boundary", () => {
    expect(parseAiSseDataLine("data: {not-json}")).toBeNull();
    expect(parseAiSseDataLine('data: {"type":"future_event"}')).toBeNull();
    expect(parseAiSseDataLine('data: {"type":"stage","stage":"calling-model"}'))
      .toEqual({ type: "stage", stage: "calling-model" });
  });
});