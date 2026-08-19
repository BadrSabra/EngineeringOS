/**
 * Guards shared by AI integration fixtures.
 *
 * Deterministic tests must never turn a missing fixture value into a real
 * provider/tool call or an untracked success response.
 */
export function takeFixture<T>(queue: T[], fixtureName: string): T {
  if (queue.length === 0) {
    throw new Error(`[AI fixture:${fixtureName}] provider/tool data exhausted`);
  }
  return queue.shift() as T;
}

/**
 * Arabic-language fixtures must retain at least one Arabic-script character.
 * Keep this assertion at fixture construction time so a language regression
 * fails before the scenario's behavioral assertions hide the real cause.
 */
export function assertArabicFixtureResponse(
  response: string,
  fixtureName: string,
): string {
  if (!/[\u0600-\u06ff]/u.test(response)) {
    throw new Error(
      `[AI fixture:${fixtureName}] expected an Arabic response, but the fixture is English-only`,
    );
  }
  return response;
}

export const REAL_TOOL_FIXTURES_ENV =
  "AI_ORCHESTRATOR_ALLOW_REAL_TOOL_FIXTURES";

export function realToolFixturesEnabled(): boolean {
  return process.env[REAL_TOOL_FIXTURES_ENV] === "1";
}
