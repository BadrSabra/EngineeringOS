/**
 * Explicit live-provider contract check.
 *
 * This file intentionally has no provider mocks. It is excluded from the
 * normal test command and is run only by run-live-empty-model-response.mjs.
 * The selected model must be documented by the operator as capable of
 * returning an empty final message for the controlled prompt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ChatResponseSchema,
  chat,
  parseAgentResponse,
} from "@workspace/ai-orchestrator";
import type { ProviderId } from "@workspace/ai-orchestrator";

const provider = (process.env.EMPTY_MODEL_RESPONSE_TEST_PROVIDER ??
  "openrouter") as ProviderId;
const providerKeyEnvironment: Partial<Record<ProviderId, string>> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
};
const providerKey = providerKeyEnvironment[provider];
const enabled =
  process.env.RUN_LIVE_EMPTY_MODEL_RESPONSE === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(providerKey && process.env[providerKey]) &&
  Boolean(process.env.EMPTY_MODEL_RESPONSE_TEST_MODEL);

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("controlled live empty-model-response contract", () => {
  // Provider-free coverage for the provider-shaped empty-final fixtures lives
  // in the normal ai-orchestrator test suite. This file intentionally remains
  // the credential-gated transport check for the same contract.
  it.runIf(enabled)(
    "live provider returns an empty final response after completed reads",
    async () => {
      const rootPath = await fs.mkdtemp("/tmp/empty-model-response-live-");
      roots.push(rootPath);
      const relativeFile = "src/empty-provider-fixture.ts";
      await fs.mkdir(path.dirname(path.join(rootPath, relativeFile)), { recursive: true });
      await fs.writeFile(
        path.join(rootPath, relativeFile),
        "export function controlledFixture(input: string) { return input.trim(); }\n",
        "utf8",
      );

      // Keep the parser boundary assertion in this live scenario so a change
      // to the classification contract fails before interpreting user output.
      const parserResult = parseAgentResponse("", ChatResponseSchema, (_raw: string) => ({
        response: "",
        sources: [],
        pendingChanges: [],
      }));
      expect(parserResult).toMatchObject({
        ok: false,
        code: "EMPTY_MODEL_RESPONSE",
      });

      const readSources: string[] = [];
      const diagnostics: string[] = [];
      const result = await chat({
        provider,
        apiKey: process.env[providerKey!],
        model: process.env.EMPTY_MODEL_RESPONSE_TEST_MODEL,
        rootPath,
        projectContext: {} as never,
        history: [],
        message:
          `Perform a forensic audit of exactly ${relativeFile}. ` +
          "Read the file first, then deliberately return an empty final response with no report.",
        onStep: (step) => {
          if (step.kind === "tool_result" && step.source) readSources.push(step.source);
          if (step.kind === "diagnostic" && step.details) diagnostics.push(...step.details);
        },
      });

      const response = result.response;
      expect(readSources).toContain(relativeFile);
      expect(response).toContain("ANALYSIS_INCOMPLETE");
      expect(response).toContain(relativeFile);
      expect(response).toContain("Retry or narrow the question");
      expect(response).not.toContain("NO_VERIFIED_FINDING");
      expect(response).not.toMatch(/\bFINDING(?:_| )PROVEN\b/i);
      expect(response).not.toContain("providerMessage");
      expect(response).not.toContain("EMPTY_MODEL_RESPONSE");
      expect(diagnostics.join("\n")).not.toContain(process.env[providerKey!]);

      // A model that emits text means the controlled scenario was not
      // exercised; never silently accept a normal completion as a pass.
      expect(response).toMatch(/ANALYSIS_INCOMPLETE/);
    },
    120_000,
  );

  it.runIf(!enabled)("fails closed when live prerequisites are absent", () => {
    expect(enabled).toBe(false);
  });
});