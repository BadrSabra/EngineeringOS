/**
 * Base agent pipeline for structured single-shot LLM tasks.
 *
 * Consolidates the common flow shared by task-agent, scan-analyst, and
 * code-reviewer:
 *   1. build messages
 *   2. select a quality-aware execution plan
 *   3. call the configured provider with bounded retries
 *   4. parse JSON into the declared schema
 *   5. attach a parse-failure marker when validation degrades
 */
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import { agentComplete, type AgentCompleteOpts } from "../agent-complete.js";
import { parseAgentResponse } from "../parsing.js";
import { assessStructuredOutput, type QualityProfile } from "../quality-engine.js";
import { resolveExecutionDecision } from "../model-selection/decision-engine.js";
import { decideRetry } from "../quality/retry-controller.js";
import type { Message } from "../groq-client.js";
import type { ZodType, ZodTypeDef } from "zod";

export type AgentRunResult<T> = T & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

export abstract class BaseAgent<TInput, TOutput> {
  protected abstract readonly scope: string;
  protected abstract readonly schema: ZodType<TOutput, ZodTypeDef, any>;
  protected abstract buildMessages(input: TInput): Message[];
  protected abstract fallbackOutput(raw: string): TOutput;

  protected buildQualityProfile(_input: TInput): QualityProfile | undefined {
    switch (this.scope) {
      case "task-agent":
        return "task_execution";
      case "scan-analyst":
        return "analysis";
      case "code-reviewer":
        return "code_review";
      case "workflow-orchestrator":
        return "workflow";
      default:
        return undefined;
    }
  }

  protected buildCompleteOpts(_input: TInput): AgentCompleteOpts {
    return {};
  }

  protected async complete(messages: Message[], opts: AgentCompleteOpts): Promise<{ content: string }> {
    try {
      return await agentComplete(messages, opts);
    } catch (err) {
      if (err instanceof GroqClientError && err.code === "NON_200") {
        console.warn(JSON.stringify({ scope: this.scope, code: "MODEL_RETRY", originalError: err.code }));
        return await agentComplete(messages, opts);
      }
      throw err;
    }
  }

  async run(input: TInput, opts?: AgentCompleteOpts): Promise<AgentRunResult<TOutput>> {
    const messages = this.buildMessages(input);
    const executionPlan = resolveExecutionDecision(this.scope, {
      qualityProfile: opts?.qualityProfile ?? this.buildQualityProfile(input),
    });
    const qualityProfile = opts?.qualityProfile ?? this.buildQualityProfile(input) ?? executionPlan.qualityProfile;
    const parseResponse = (raw: string) => parseAgentResponse(raw, this.schema, (fallbackRaw) => this.fallbackOutput(fallbackRaw));

    opts?.onProgress?.("Calling AI model…");
    const response = await this.complete(messages, {
      ...this.buildCompleteOpts(input),
      ...(opts ?? {}),
      qualityProfile,
      qualityHints: opts?.qualityHints ?? executionPlan.strictHints,
    });

    let parsed = parseResponse(response.content);
    let parseError = parsed.ok ? undefined : { code: parsed.code, message: parsed.message, raw: parsed.raw };
    const initialAssessment = parsed.ok && qualityProfile ? assessStructuredOutput(qualityProfile, parsed.data) : undefined;
    let attempt = 1;
    let assessment = initialAssessment;
    while (attempt < executionPlan.retryLimit) {
      const retryDecision = decideRetry({
        attempt,
        limit: executionPlan.retryLimit,
        parseError,
        assessment,
      });
      if (!retryDecision.shouldRetry) break;
      console.warn(
        JSON.stringify({
          scope: this.scope,
          code: "MODEL_RETRY",
          reason: retryDecision.reason,
          qualityProfile,
        }),
      );

      opts?.onProgress?.("Retrying — improving output quality…");
      const retryResponse = await this.complete(messages, {
        ...this.buildCompleteOpts(input),
        ...(opts ?? {}),
        qualityProfile,
        qualityHints: executionPlan.relaxedHints,
      });

      parsed = parseResponse(retryResponse.content);
      parseError = parsed.ok ? undefined : { code: parsed.code, message: parsed.message, raw: parsed.raw };
      assessment = parsed.ok && qualityProfile ? assessStructuredOutput(qualityProfile, parsed.data) : undefined;
      attempt += 1;
    }

    if (!parsed.ok) {
      console.warn(JSON.stringify({ scope: this.scope, code: parsed.code, message: parsed.message }));
      return { ...parsed.data, _parseError: parseError };
    }

    assessment = qualityProfile ? assessStructuredOutput(qualityProfile, parsed.data) : undefined;
    if (assessment && assessment.decision !== "accept") {
      console.warn(
        JSON.stringify({
          scope: this.scope,
          code: "QUALITY_REVIEW_LOW",
          qualityProfile,
          score: assessment.score,
          threshold: assessment.threshold,
          reasons: assessment.reasons,
        }),
      );
    }

    // parsed.data is TOutput, which satisfies AgentRunResult<TOutput> (= T & { _parseError? })
    // because _parseError is optional. Cast is required because TypeScript cannot
    // prove T satisfies T & { _parseError?: … } for an unconstrained generic.
    return parsed.data as AgentRunResult<TOutput>;
  }
}
