/**
 * Deterministic completion checks for task-shaped chat requests.
 *
 * This module deliberately knows nothing about model prose. An item is only
 * marked complete when the tool-loop telemetry contains a matching observable
 * action. Unknown requirements remain incomplete.
 */

import type { AgentStep } from "./tool-execution-engine.js";

export type TaskChecklistItem = {
  index: number;
  text: string;
};

export type TaskChecklistItemResult = {
  item: TaskChecklistItem;
  complete: boolean;
  evidence: string[];
  reason?: string;
};

const CHECKLIST_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:done\s+looks\s+like|acceptance\s+criteria|definition\s+of\s+done|معايير\s+القبول|معيار\s+الإنجاز|معيار\s+الانجاز)\s*:?\s*(.*)$/i;

const SECTION_BOUNDARY_RE =
  /^(?:#{1,6}\s*)?(?:what\s*&\s*why|why|relevant\s+files|context|constraints|notes|scope|المطلوب|الملفات\s+ذات\s+الصلة|السياق|القيود)\s*:?\s*$/i;

const PATH_RE =
  /`([^`\n]+\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|vue|svelte|sql|sh|md))`|(?:^|[\s("'`])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|vue|svelte|sql|sh|md))(?=$|[\s)"'`,.;:!?])/gi;

const SIMPLE_TEST_FILE_RE =
  /(?<![\w/@.-])[\w@.-]+\.(?:test|spec)\.[cm]?[jt]sx?(?![\w.-])/gi;

const WRITE_TOOL_NAMES = new Set(["replace_text", "write_file"]);
const VALIDATION_TOOL_RE = /(?:run|test|check|validat|typecheck|tsc|vitest|jest|pytest|lint)/i;
const SEARCH_RE = /\b(?:search|find|locate|grep|scan)\b/i;
const READ_RE = /\b(?:read|inspect|review|trace|verify|check|confirm)\b/i;
const WRITE_RE =
  /\b(?:add|create|edit|update|modify|implement|fix|write|change|cover|build|introduce)\b/i;

function normalizePath(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .replace(/[),.;:!?]+$/, "");
}

export function extractChecklistPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(PATH_RE)) {
    const candidate = normalizePath(match[1] ?? match[2] ?? "");
    if (candidate) paths.push(candidate);
  }
  for (const match of text.matchAll(SIMPLE_TEST_FILE_RE)) {
    const candidate = normalizePath(match[0] ?? "");
    if (candidate) paths.push(candidate);
  }
  return [...new Set(paths)];
}

function cleanChecklistText(value: string): string {
  return value
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the first Done-looks-like / acceptance-criteria section.
 *
 * Both bullet lists and the plain one-item-per-line format used by copied task
 * cards are accepted. The section ends at the next common task-card heading.
 */
export function parseTaskChecklist(message: string): TaskChecklistItem[] {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  const headingIndex = lines.findIndex((line) => CHECKLIST_HEADING_RE.test(line.trim()));
  if (headingIndex < 0) return [];

  const heading = lines[headingIndex]!.trim().match(CHECKLIST_HEADING_RE);
  const inlineItem = heading?.[1] ? cleanChecklistText(heading[1]) : "";
  const candidates: string[] = inlineItem ? [inlineItem] : [];
  const sectionLines: string[] = [];

  for (const rawLine of lines.slice(headingIndex + 1)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (CHECKLIST_HEADING_RE.test(line) || SECTION_BOUNDARY_RE.test(line)) break;
    if (/^#{1,6}\s+\S/.test(line)) break;
    sectionLines.push(line);
  }

  const hasBullets = sectionLines.some((line) => /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line));
  if (hasBullets) {
    for (const line of sectionLines) {
      if (/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
        const cleaned = cleanChecklistText(line);
        if (cleaned) candidates.push(cleaned);
      } else if (candidates.length > 0) {
        // Wrapped lines belong to the preceding bullet.
        candidates[candidates.length - 1] = cleanChecklistText(
          `${candidates[candidates.length - 1]} ${line}`,
        );
      }
    }
  } else {
    for (const line of sectionLines) {
      const cleaned = cleanChecklistText(line);
      if (cleaned) candidates.push(cleaned);
    }
  }

  return [...new Set(candidates)].map((text, index) => ({ index: index + 1, text }));
}

type ObservedToolCall = {
  tool: string;
  args: Record<string, string>;
};

function collectObservedToolCalls(steps: AgentStep[]): ObservedToolCall[] {
  const pending = new Map<string, Record<string, string>[]>();
  const completed: ObservedToolCall[] = [];

  for (const step of steps) {
    if (step.kind === "tool_call") {
      const calls = pending.get(step.tool) ?? [];
      calls.push(step.args);
      pending.set(step.tool, calls);
      continue;
    }
    if (step.kind !== "tool_result") continue;
    const calls = pending.get(step.tool) ?? [];
    const args = calls.shift() ?? {};
    if (calls.length === 0) pending.delete(step.tool);
    else pending.set(step.tool, calls);
    completed.push({ tool: step.tool, args });
  }
  return completed;
}

function pathMatches(observed: string, expected: string): boolean {
  const actual = normalizePath(observed);
  const target = normalizePath(expected);
  return actual === target || actual.endsWith(`/${target}`) || target.endsWith(`/${actual}`);
}

export function evaluateTaskChecklist(
  items: TaskChecklistItem[],
  steps: AgentStep[],
): TaskChecklistItemResult[] {
  const completedTools = collectObservedToolCalls(steps);
  const readFiles = new Set(
    [
      ...steps
        .filter((step): step is Extract<AgentStep, { kind: "tool_result" }> =>
          step.kind === "tool_result" && step.tool === "read_file" && Boolean(step.source),
        )
        .map((step) => normalizePath(step.source!)),
      ...completedTools
        .filter((call) => call.tool === "read_file" && typeof call.args.path === "string")
        .map((call) => normalizePath(call.args.path)),
    ],
  );
  const searchCount = completedTools.filter((call) => call.tool === "search_code").length;
  const validationCalls = completedTools.filter((call) => VALIDATION_TOOL_RE.test(call.tool));
  const writeFiles = completedTools
    .filter((call) => WRITE_TOOL_NAMES.has(call.tool) && typeof call.args.path === "string")
    .map((call) => normalizePath(call.args.path));
  const hasAnyEvidence = completedTools.length > 0 || readFiles.size > 0;

  return items.map((item) => {
    const paths = extractChecklistPaths(item.text);
    const normalizedText = item.text.toLowerCase();

    if (VALIDATION_TOOL_RE.test(normalizedText)) {
      if (validationCalls.length > 0) {
        return {
          item,
          complete: true,
          evidence: [`validation tool completed (${validationCalls[0]!.tool})`],
        };
      }
      return {
        item,
        complete: false,
        evidence: [],
        reason: "No completed validation/test tool event was observed.",
      };
    }

    if (paths.length > 0) {
      const isWriteRequirement = WRITE_RE.test(normalizedText) && !READ_RE.test(normalizedText);
      const observed = isWriteRequirement ? writeFiles : [...readFiles];
      const missing = paths.filter((path) => !observed.some((actual) => pathMatches(actual, path)));
      if (missing.length === 0) {
        return {
          item,
          complete: true,
          evidence: paths.map((path) =>
            `${isWriteRequirement ? "edit proposed" : "file read"}: ${path}`,
          ),
        };
      }
      return {
        item,
        complete: false,
        evidence: [],
        reason: `No ${isWriteRequirement ? "completed edit proposal" : "completed read"} was observed for: ${missing.join(", ")}.`,
      };
    }

    if (SEARCH_RE.test(normalizedText)) {
      return searchCount > 0
        ? {
            item,
            complete: true,
            evidence: [`search_code completed (${searchCount} call${searchCount === 1 ? "" : "s"})`],
          }
        : {
            item,
            complete: false,
            evidence: [],
            reason: "No completed search_code event was observed.",
          };
    }

    return {
      item,
      complete: false,
      evidence: [],
      reason: hasAnyEvidence
        ? "No direct telemetry rule can prove this requirement."
        : "No completed tool event was observed.",
    };
  });
}

function validatorDescription(item: TaskChecklistItem): string {
  const paths = extractChecklistPaths(item.text);
  const normalizedText = item.text.toLowerCase();

  if (VALIDATION_TOOL_RE.test(normalizedText)) {
    return "YES only if a completed validation/test tool event is present in telemetry; otherwise NO";
  }
  if (paths.length > 0) {
    const isWriteRequirement = WRITE_RE.test(normalizedText) && !READ_RE.test(normalizedText);
    return isWriteRequirement
      ? `YES only if completed ${[...WRITE_TOOL_NAMES].join(" or ")} telemetry proves an edit proposal for ${paths.join(", ")}; otherwise NO`
      : `YES only if completed read_file telemetry proves that ${paths.join(", ")} was read; otherwise NO`;
  }
  if (SEARCH_RE.test(normalizedText)) {
    return "YES only if completed search_code telemetry is present; otherwise NO";
  }
  return "YES only if a direct matching completed tool event proves this requirement; otherwise NO";
}

/**
 * Build the validator-owned contract injected into the system prompt.
 *
 * The model may use this contract to plan its work, but it cannot mark an item
 * complete by assertion. Final answers are checked again against AgentStep
 * telemetry by evaluateTaskChecklist().
 */
export function buildTaskCompletionContract(items: TaskChecklistItem[]): string {
  if (items.length === 0) return "";
  return [
    "The following completion contract is validator-owned.",
    "Treat every item as a YES/NO question. Answer YES internally only when its validator condition is proven by completed tool telemetry.",
    "Never claim the task is complete because the item appears in your prose; an unproven item must remain unfinished in the final response.",
    ...items.map(
      (item) =>
        `${item.index}. YES/NO — ${item.text}\n   Validator: ${validatorDescription(item)}`,
    ),
  ].join("\n");
}

export function appendTaskChecklistReport(
  response: string,
  items: TaskChecklistItem[],
  steps: AgentStep[],
): string {
  if (items.length === 0) return response;
  const results = evaluateTaskChecklist(items, steps);
  const incomplete = results.filter((result) => !result.complete);
  const lines = [
    response.trim(),
    "",
    "## Deterministic task completion checklist",
    ...results.map((result) =>
      result.complete
        ? `- [x] ${result.item.text} — Evidence: ${result.evidence.join("; ")}`
        : `- [ ] ${result.item.text} — Unproven: ${result.reason ?? "No direct evidence."}`,
    ),
  ];
  if (incomplete.length > 0) {
    lines.push(
      "",
      "### Unfinished items",
      ...incomplete.map((result) => `- ${result.item.text}`),
      "",
      "These items remain unfinished because the tool telemetry did not prove them; the model's summary was not used as evidence.",
    );
  }
  return lines.join("\n");
}