/**
 * Post-generation evidence gate for structured forensic audits.
 *
 * The model is still responsible for writing the report, but it is not the
 * final authority on whether a Finding is proven. This module only downgrades
 * claims; it never invents a finding or silently deletes the model's report.
 */

import {
  isForensicTestSourcePath,
  isPathWithinForensicScope,
  normalizeForensicSourcePath,
} from "./forensic-source-policy.js";

export type ForensicEvidenceScope = {
  roots?: readonly string[];
  files?: readonly string[];
  /**
   * Paths that are always admissible regardless of the roots/files manifest.
   * Populated from First-Evidence Gate DIRECT_READ primary targets so a
   * text-derived roots list can never exclude the file the agent was obligated
   * to read first.
   */
  admit?: readonly string[];
};

export type ForensicRootCoverage = {
  root: string;
  discoveredFiles: number;
  readFiles: number;
  unreadFiles: number;
  status: "COMPLETE" | "EMPTY" | "PARTIAL" | "BUDGET_EXHAUSTED";
};

export type ForensicSourceCoverage = {
  complete: boolean;
  /**
   * Explicit file manifest for file-scoped audits, retained in request order.
   * This is the canonical set that coverage must account for; rootCoverage is
   * the per-entry result projection.
   */
  requestedFiles?: readonly string[];
  roots: readonly ForensicRootCoverage[];
  reason?: string;
};

export type ForensicEvidence = {
  /** Sources actually returned by read/list/search tools during this turn. */
  toolSources: string[];
  /** Complete (or bounded) read_file outputs keyed by project-relative path. */
  fileContents: Map<string, string>;
  /** Exact search_code result text keyed by the concrete path it mentions. */
  searchResults?: Map<string, string>;
  /** Production audits default to false; capability tests may opt in. */
  allowTestSources?: boolean;
  /** Optional project-relative scope enforced before evidence is exposed. */
  scope?: ForensicEvidenceScope;
  /** Reads carrying a truncation marker cannot prove a Finding. */
  incompleteFiles?: Set<string>;
  /** Deterministic scoped-discovery coverage. Incomplete coverage blocks Findings. */
  sourceCoverage?: ForensicSourceCoverage;
  /**
   * Workspace reviews make a stronger promise than ordinary forensic reports:
   * every accepted claim must be backed by a retained completed file body.
   * Search snippets and source labels are discovery hints, not proof.
   */
  requireCompleteReadEvidence?: boolean;
};

type EvidenceMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    function?: { name?: string; arguments?: unknown };
  }>;
  tool_call_id?: string;
};

export type ForensicEvidenceViolation = {
  findingId: string;
  reasons: string[];
};

export type ForensicGateResult = {
  response: string;
  violations: ForensicEvidenceViolation[];
};

export type ForensicContractResult = {
  response: string;
  valid: boolean;
  violations: string[];
  /** True when the final report was rebuilt deterministically from retained reads. */
  evidenceMapRebuilt?: boolean;
};

const COMPACT_FORENSIC_HEADERS = [
  "## Verdict",
  "## Direct Evidence",
  "## Finding",
  "## Repair Plan",
  "## Validation",
] as const;

const FINDING_START = /^\s*(?:[*-]\s*)?ID:\s*(F-\d+)\s*·\s*([^\n]+)$/gim;
const FILE_LINE = /^\s*(?:\*\s*)?File(?:\(s\))?:\s*(.+)$/im;
const EVIDENCE_LINE = /^\s*(?:\*\s*)?Evidence:\s*(.+)$/im;
const PLAN_LINE = /^(\s*Phase\s+\d+\s+\((F-\d+)\):[^\n]*)$/gim;
const FORENSIC_SECTION_HEADERS = [
  "## 1) Executive Verdict",
  "## 2) Evidence Map",
  "## 3) Findings",
  "## 4) Repair Plan",
  "## 5) Validation Checklist",
  "## 6) Final Judgment",
] as const;

const PATH_RE =
  /`([^`\n]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml))`/g;
const SOURCE_CHANGE_ACTION =
  /(?:fix|update|adjust|modify|change|add|remove|replace|refactor|implement|patch|rewrite|correct|batch|split|تعديل|إصلاح|تصحيح|إضافة|حذف|استبدال|تقسيم|إعادة\s+هيكلة)/i;
const BEHAVIORAL_VALIDATION_SIGNAL =
  /\b(?:test|tests|testing|regression|assert|verify|verified|validate|validation|behavior|behaviour|reproduc|security|endpoint|route|api|query|graph|orchestrator|chat|input|output|request|response|failure|error|eval)\b/i;

const PLACEHOLDER_EVIDENCE = [
  /^\[.*\]$/,
  /^<.*>$/,
  /^(?:an exact|the exact|specific) (?:source|code|function|line)/i,
  /^(?:not provided|unknown|n\/a|none)$/i,
];

const PLACEHOLDER_REPORT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\[\s*pass\/fail\s+test\s+scenario\b/i,
    reason: "Validation Checklist contains an unresolved pass/fail scenario placeholder",
  },
  {
    pattern: /\[\s*(?:exact\s+)?code\s+reference\s+needed\s*\]/i,
    reason: "Final Judgment contains an unresolved code-reference placeholder",
  },
  {
    pattern: /\bpath\/to\/file\.(?:ts|tsx|js|jsx)\b|`affected-file\.[a-z]+`/i,
    reason: "the report contains a sample source path instead of a verified path",
  },
  {
    pattern: /\[(?:2-3 lines|one line|exact code snippet|specific action|root cause|impact|repeat for each)/i,
    reason: "the report contains copied template instructions",
  },
];

const DISPLAY_TRUNCATION_MARKERS = [
  /\[prefetch output truncated\b/i,
  /\[read output truncated\b/i,
  /\[.*forensic read exceeded the maximum safe evidence window\b/i,
  /\.\.\.\s*\[\d+\s+(?:lines?|bytes?)\s+omitted\b/i,
  /\[\d+\s+(?:lines?|bytes?)\s+omitted\b/i,
  /\bdisplay limit\b.*\b(?:truncat|omitt)/i,
];

function hasDisplayTruncationMarker(content: string): boolean {
  return DISPLAY_TRUNCATION_MARKERS.some((pattern) => pattern.test(content));
}

/**
 * Known false-positive shapes seen in forensic reports. These are deliberately
 * narrow: they guard claims that are invalid by the semantics of the cited
 * API, not every possible architectural opinion.
 */
function knownFalsePositiveReasons(block: string): string[] {
  const lower = block.toLowerCase();
  const reasons: string[] = [];

  if (
    /json\.parse/.test(lower) &&
    /circular reference|circular object|circular json/.test(lower)
  ) {
    reasons.push("JSON text cannot contain a circular object reference for JSON.parse to detect");
  }

  if (
    /buildslice/.test(lower) &&
    /unbounded|unlimited|without (?:a )?size limit|memory growth|memory exhaustion/.test(lower)
  ) {
    reasons.push("the Finding confuses slice construction with the separate admission/budget pass");
  }

  if (
    /maxretries|retry loop|retry logic/.test(lower) &&
    /infinite|off.?by.?one|attempt\s*<\s*maxretries|change .*<=.*</.test(lower)
  ) {
    reasons.push("a bounded attempt <= maxRetries loop with an attempt < maxRetries continuation guard is not infinite");
  }

  if (
    /export\s+(?:\{[^}\n]*(?:error|exception)|type\s+\{[^}\n]*(?:error|exception))/i.test(block) &&
    /(?:no|missing|not found|absence|without).{0,40}(?:error|exception)\s*handling|(?:error|exception)\s*handling.{0,40}(?:no|missing|not found|absent)/i.test(lower)
  ) {
    reasons.push("an exported error type does not prove that internal error handling is absent");
  }

  if (
    /(?:schema|context|dependency|manifest|workspace)/.test(lower) &&
    /(?:not\s+(?:read|inspected|checked)|unread|not\s+available|unable\s+to\s+verify|cannot\s+verify|عدم\s+قراءة|لم\s+تتم\s+قراءة|غير\s+مقروء)/.test(
      lower,
    ) &&
    /(?:root\s+cause|why\s+it\s+matters|fix|mismatch|incompatible|عدم\s+توافق)/.test(lower)
  ) {
    reasons.push("a missing schema/context read is a verification gap, not a proven implementation defect");
  }

  if (
    /(?:memory|performance|latency|slow|overhead|allocation|complexity|o\([^)]+\))/.test(lower) &&
    /(?:additional|extra|consume|consumes|waste|growth|exhaust|may\s+use|could\s+use|قد\s+يستهلك|استهلاك)/.test(lower) &&
    !/(?:benchmark|benchmarked|measure(?:d|ment)?|profile(?:d|ing)?|heap|bytes|milliseconds|\bms\b|timed|reproduced|test\s+result)/.test(
      lower,
    )
  ) {
    reasons.push("the performance or memory impact is asserted without a completed measurement or reproducible result");
  }

  if (
    /catalog\s*:/.test(lower) &&
    /(?:version|unpinned|unspecified|not\s+(?:pinned|specified|resolved)|missing|غير\s+محدد|غير\s+مثبت)/.test(
      lower,
    )
  ) {
    reasons.push("a package-manager catalog alias does not prove a missing version without the root catalog or lockfile");
  }

  return reasons;
}

function sourceConflictsWithFinding(
  block: string,
  evidenceText: string,
  sourceContents: string[],
): string[] {
  const lower = block.toLowerCase();
  const evidenceLower = evidenceText.toLowerCase();
  const reasons: string[] = [];
  const source = sourceContents.join("\n").toLowerCase();

  if (
    /maxdepth/.test(lower) &&
    /(?:unlimited|unbounded|without (?:a )?bound|no (?:upper )?limit|dos|resource exhaustion)/.test(lower) &&
    /math\.min\s*\(\s*maxdepth\s*,\s*6\s*\)/.test(source) &&
    /currentdepth\s*<\s*depth/.test(source)
  ) {
    reasons.push("the implementation caps maxDepth at 6 and bounds traversal by the capped depth");
  }

  if (
    /\bexport\b/.test(evidenceLower) &&
    /(?:without|missing|no|lack of|absent).{0,80}(?:authentication|auth|rate.?limit|usage\s+quota|access\s+control)|(?:authentication|auth|rate.?limit|usage\s+quota|access\s+control).{0,80}(?:without|missing|no|lack of|absent)/.test(lower)
  ) {
    reasons.push("a barrel export does not establish the presence or absence of API authentication or rate limiting");
  }

  if (
    /entitycount/.test(lower) &&
    /(?:always\s+returns\s+0|incomplete|placeholder|not\s+yet\s+wired|broken|incorrect)/.test(lower) &&
    !/entitycount/.test(source)
  ) {
    reasons.push("the cited entityCount implementation is absent from the inspected source");
  }

  if (
    /(?:silent|silently|without\s+(?:proper\s+)?alert|hide(?:s|ing)?\s+critical)/.test(lower) &&
    /return\s+fallback/.test(source) &&
    /console\.(?:warn|error|info)\s*\(/.test(source)
  ) {
    reasons.push("the fallback path emits structured console telemetry and is not silent in the inspected source");
  }

  return reasons;
}

function extractPaths(text: string): string[] {
  const paths: string[] = [];
  PATH_RE.lastIndex = 0;
  for (const match of text.matchAll(PATH_RE)) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  const barePathRe =
    /(?<![\w/@.`])((?:\.{0,2}\/|lib\/|src\/|artifacts\/|packages\/)[\w.@/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml))/g;
  for (const match of text.matchAll(barePathRe)) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  return paths;
}

function normalizePath(path: string): string {
  return normalizeForensicSourcePath(path);
}

function normalizeToolEvidence(content: string): string {
  const withoutMetadata = content
    .replace(
      /^\[cached — identical call already executed this request\]\s*\n?/u,
      "",
    )
    .replace(
      /^\[cached — identical call already executed this request\]\s*\n?/u,
      "",
    )
    .replace(
      /\n\nEXECUTION GUARD: Do not call this same tool with the same arguments again\.[\s\S]*$/u,
      "",
    )
    .trim();

  // read_file returns a transport wrapper (`File: ...` + fenced content).
  // The wrapper is provenance metadata, not source evidence. Store only the
  // fenced body so fallback snippets and FACT matching cannot cite the path
  // label as if it were code.
  const wrapped = withoutMetadata.match(
    /^(?:\[note:[^\n]*\]\s*\n)?File:\s*[^\n]+\n```[^\n]*\n([\s\S]*?)\n```\s*$/u,
  );
  if (wrapped) return wrapped[1]!.trim();

  // A File: label without a fenced body is an incomplete tool result.
  if (/^(?:\[note:[^\n]*\]\s*\n)?File:\s*[^\n]+$/u.test(withoutMetadata)) {
    return "";
  }

  return withoutMetadata;
}

function isInvalidToolEvidence(content: string): boolean {
  const trimmed = content.trim();
  return (
    !trimmed ||
    /^Error\b/i.test(trimmed) ||
    /^Contents of\s+/i.test(trimmed) ||
    /^Synthesis phase is active\./i.test(trimmed) ||
    /^Forensic collection stopped\./i.test(trimmed) ||
    /^(?:Production forensic audits exclude|This ordered forensic audit permits|This isolated forensic test permits|Tool ".*" is blocked by the active forensic tool policy)/i.test(trimmed)
  );
}

function isAllowedEvidencePath(
  filePath: string,
  allowTestSources: boolean,
  scope?: ForensicEvidenceScope,
): boolean {
  const normalized = normalizePath(filePath);
  return (
    isPathWithinForensicScope(normalized, scope) &&
    (allowTestSources || !isForensicTestSourcePath(normalized))
  );
}

function hasReadEvidence(
  filePaths: string[],
  evidence: ForensicEvidence,
  evidenceText: string,
): boolean {
  const readSources = new Set(evidence.toolSources.map(normalizePath));
  const candidateFiles = filePaths.map(normalizePath);
  const matchingFiles = candidateFiles.filter((file) => readSources.has(file) || evidence.fileContents.has(file));
  if (matchingFiles.length === 0 || matchingFiles.length !== candidateFiles.length) return false;
  if (matchingFiles.some((file) => evidence.incompleteFiles?.has(file))) return false;
  if (
    evidence.requireCompleteReadEvidence &&
    matchingFiles.some((file) => !evidence.fileContents.has(file))
  ) {
    return false;
  }

  const cleaned = evidenceText
    .replace(/[`"'*>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || PLACEHOLDER_EVIDENCE.some((pattern) => pattern.test(cleaned))) return false;

  // The deterministic fallback map cites the completed tool result itself
  // rather than repeating an arbitrary source line. That is authoritative
  // only when the corresponding complete body is actually present; a
  // toolSources label without fileContents must never satisfy this branch.
  if (
    /\bcompleted\s+read_file\s+result\b/i.test(evidenceText) &&
    matchingFiles.every((file) => evidence.fileContents.has(file))
  ) {
    return true;
  }

  const quotedFragments = [...evidenceText.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1]?.trim())
    .filter((fragment): fragment is string => Boolean(fragment));

  // Every cited file must contain the cited fragment. A snippet from one file
  // must never prove a multi-file claim about another file.
  for (const file of matchingFiles) {
    const content = evidence.fileContents.get(file);
    const searchContent = evidence.searchResults?.get(file);
    const available = [content, searchContent].filter((value): value is string => Boolean(value));
    if (available.length === 0) return false;
    const lineReference = evidenceText.match(/\bline\s+(\d+)\b/i);
    const lineMatches = lineReference
      ? available.some((value) => {
          const line = value.split("\n")[Number(lineReference[1]) - 1]?.trim();
          return Boolean(line && (cleaned.includes(line) || quotedFragments.includes(line)));
        })
      : false;
    const exactMatch =
      quotedFragments.some((fragment) => available.some((value) => value.includes(fragment))) ||
      available.some((value) => value.includes(cleaned));
    if (!exactMatch && !lineMatches) return false;
  }

  return matchingFiles.length > 0;
}

function findingBlocks(response: string): Array<{ id: string; start: number; end: number; block: string }> {
  const starts = [...response.matchAll(FINDING_START)];
  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < starts.length
      ? (starts[index + 1]?.index ?? response.length)
      : (response.slice(start).search(/\n##\s*4\)/i) >= 0
        ? start + (response.slice(start).search(/\n##\s*4\)/i) ?? response.length)
        : response.length);
    return { id: match[1]!, start, end, block: response.slice(start, end) };
  });
}

function rewriteFinalJudgment(response: string, judgment: string): string {
  const header = /^\s*##\s*6\)\s*Final Judgment\s*$/im;
  const match = header.exec(response);
  if (!match || match.index === undefined) return response;
  const bodyStart = match.index + match[0].length;
  return `${response.slice(0, bodyStart)}\n${judgment}\n`;
}

function headerCount(response: string, header: string): number {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...response.matchAll(new RegExp(`^\\s*${escaped}\\s*$`, "gim"))].length;
}

function sectionBody(
  response: string,
  sectionHeader: string,
  nextHeader: string,
): string {
  const start = response.search(new RegExp(`^\\s*${sectionHeader}\\s*$`, "im"));
  if (start < 0) return "";
  const newline = response.indexOf("\n", start);
  if (newline < 0) return "";
  const bodyStart = newline + 1;
  const remainder = response.slice(bodyStart);
  const end = remainder.search(new RegExp(`^\\s*${nextHeader}\\s*$`, "im"));
  return end >= 0 ? remainder.slice(0, end) : remainder;
}

function sectionOrderViolations(response: string): string[] {
  const positions = FORENSIC_SECTION_HEADERS.map((header) => ({
    header,
    position: response.search(
      new RegExp(
        `^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "im",
      ),
    ),
  }));
  if (positions.some(({ position }) => position < 0)) return [];
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index]!.position < positions[index - 1]!.position) {
      return ["Forensic report sections must appear in the required order"];
    }
  }
  return [];
}

function executiveVerdictContractViolations(response: string): string[] {
  const verdict = sectionBody(
    response,
    "## 1\\) Executive Verdict",
    "## 2\\) Evidence Map",
  );
  if (!verdict) return [];

  const broadClaims = [
    /\bwell[-\s]structured\b/i,
    /\bcomprehensive functionality\b/i,
    /\bcomprehensive (?:error handling|coverage|architecture|system)\b/i,
    /\brobust (?:error handling|architecture|caching|retry|reliability)\b/i,
    /\bno critical issues? identified\b/i,
    /\bhigh code quality\b/i,
    /\bproduction[-\s]safe\b/i,
    /\bfully implemented\b/i,
    /(?:منظم|منظمة)\s+(?:بشكل\s+)?جيد(?:ة)?/i,
    /(?:وظائف|تغطية|معالجة|نظام)\s+شامل(?:ة|ةً)?/i,
    /(?:معالجة|بنية|آلية)\s+(?:أخطاء\s+)?متين(?:ة|ةً)?/i,
    /(?:مكتمل|مكتملة|مكتملًا)\s+(?:بالكامل|تمامًا)?/i,
    /(?:آمن|آمنة)\s+للإنتاج/i,
    /لا\s+توجد\s+(?:أي\s+)?مشاكل\s+حرج(?:ة|ةً)?/i,
  ];
  if (broadClaims.some((pattern) => pattern.test(verdict))) {
    return [
      "Executive Verdict contains an unverified broad quality or completeness claim",
    ];
  }
  return [];
}

function broadReportClaimViolations(response: string): string[] {
  const broadClaims = [
    /\bwell[-\s]structured\b/i,
    /\bcomprehensive\b/i,
    /\brobust\b/i,
    /\b(?:sophisticated|mature|excellent)\b/i,
    /\bclean (?:separation|re-?export|architecture|abstraction|design)\b/i,
    /\bhigh code quality\b/i,
    /\bproduction[-\s](?:safe|ready)\b/i,
    /\bfully implemented\b/i,
    /\bno critical issues? identified\b/i,
    /\bno issues? identified\b/i,
    /(?:منظم|منظمة)\s+(?:بشكل\s+)?جيد(?:ة)?/i,
    /(?:وظائف|تغطية|معالجة|نظام)\s+شامل(?:ة|ةً)?/i,
    /(?:معالجة|بنية|آلية)\s+(?:أخطاء\s+)?متين(?:ة|ةً)?/i,
    /(?:ناضج|ناضجة|ممتاز|ممتازة|متطور|متطورة)/i,
    /(?:آمن|آمنة)\s+للإنتاج/i,
    /لا\s+توجد\s+(?:أي\s+)?مشاكل\s+حرج(?:ة|ةً)?/i,
  ];

  const violations = new Set<string>();
  for (const line of response.split("\n")) {
    if (!broadClaims.some((pattern) => pattern.test(line))) continue;
    // Explicitly labelled uncertainty is allowed; it is not being presented
    // as a verified FACT. This also keeps the safe fallback contract-valid.
    if (/\b(?:NOT PROVEN|INFERENCE)\b/i.test(line)) continue;
    violations.add(
      "Report contains an unverified broad quality or completeness claim outside an explicit NOT PROVEN/INFERENCE statement",
    );
  }
  return [...violations];
}

function neutralizeBroadReportClaims(response: string): string {
  const broadClaims = [
    /\bwell[-\s]structured\b/i,
    /\bcomprehensive\b/i,
    /\brobust\b/i,
    /\b(?:sophisticated|mature|excellent)\b/i,
    /\bclean (?:separation|re-?export|architecture|abstraction|design)\b/i,
    /\bhigh code quality\b/i,
    /\bproduction[-\s](?:safe|ready)\b/i,
    /\bfully implemented\b/i,
    /\bno critical issues? identified\b/i,
    /\bno issues? identified\b/i,
    /(?:منظم|منظمة)\s+(?:بشكل\s+)?جيد(?:ة)?/i,
    /(?:وظائف|تغطية|معالجة|نظام)\s+شامل(?:ة|ةً)?/i,
    /(?:معالجة|بنية|آلية)\s+(?:أخطاء\s+)?متين(?:ة|ةً)?/i,
    /(?:ناضج|ناضجة|ممتاز|ممتازة|متطور|متطورة)/i,
    /(?:آمن|آمنة)\s+للإنتاج/i,
    /لا\s+توجد\s+(?:أي\s+)?مشاكل\s+حرج(?:ة|ةً)?/i,
  ];

  return response
    .split("\n")
    .map((line) => {
      if (
        !broadClaims.some((pattern) => pattern.test(line)) ||
        /\b(?:NOT PROVEN|INFERENCE)\b/i.test(line)
      ) {
        return line;
      }

      const field = line.match(/^(\s*(?:>\s*)?(?:[*-]\s*)?)(File|Role|Evidence|Risk|Notes):\s*(.*)$/i);
      if (!field) {
        return "NOT PROVEN — the broad quality or completeness claim is not established by the inspected evidence.";
      }

      const prefix = field[1]!;
      const name = field[2]!;
      if (/^Notes$/i.test(name)) return `${prefix}Notes: NOT PROVEN`;
      if (/^Evidence$/i.test(name)) {
        return `${prefix}Evidence: completed source read; the cited quality claim is NOT PROVEN`;
      }
      return `${prefix}${name}: NOT PROVEN — no broad quality or completeness inference accepted`;
    })
    .join("\n");
}

function evidenceMapContractViolations(
  response: string,
  evidence?: ForensicEvidence,
): string[] {
  const body = sectionBody(
    response,
    "## 2\\) Evidence Map",
    "## 3\\) Findings",
  );
  if (!body) return [];
  if (/No verified evidence map was produced/i.test(body)) {
    if (evidence && evidence.fileContents.size > 0) {
      return ["Evidence Map suppresses completed source reads instead of recording them"];
    }
    return [];
  }

  const violations: string[] = [];
  const fieldLine = /^\s*(?:>\s*)?(?:[*-]\s*)?(File|Role|Evidence|Risk|Notes):\s*(.*)$/i;
  const lines = body.split("\n");
  const fileIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => fieldLine.exec(line)?.[1]?.toLowerCase() === "file")
    .map(({ index }) => index);

  if (fileIndexes.length > 0) {
    for (let recordIndex = 0; recordIndex < fileIndexes.length; recordIndex += 1) {
      const start = fileIndexes[recordIndex]!;
      const end = fileIndexes[recordIndex + 1] ?? lines.length;
      const recordLines = lines.slice(start, end);
      const fields = new Map<string, string>();

      for (const line of recordLines) {
        const match = fieldLine.exec(line);
        if (!match) continue;
        const field = match[1]!.toLowerCase();
        const value = match[2]!.trim();
        fields.set(field, value);
        if (
          field === "file" &&
          /\b(?:Role|Evidence|Risk|Notes):\s*/i.test(value)
        ) {
          violations.push(
            "Evidence Map fields must be on separate lines; a file record combines multiple fields",
          );
        }
      }

      for (const required of ["file", "role", "evidence", "risk", "notes"]) {
        if (!fields.has(required)) {
          violations.push(
            `Evidence Map record is missing a separate ${required} field`,
          );
        }
      }

      const notes = fields.get("notes");
      if (
        notes &&
        !/^(?:FACT|INFERENCE|NOT PROVEN|READ_CONFIRMED|READ_COMPLETE)(?:\s+·\s+[A-Z_]+)*$/i.test(notes)
      ) {
        violations.push(
          "Evidence Map Notes must start with FACT, INFERENCE, or NOT PROVEN and may include a bounded classification suffix",
        );
      }

      const evidenceText = fields.get("evidence") ?? "";
      const recordFiles = extractPaths(fields.get("file") ?? "").map(normalizePath);
      const completedReadSources = evidence
        ? new Set([
            ...evidence.toolSources.map(normalizePath),
            ...evidence.fileContents.keys(),
          ])
        : new Set<string>();
      const hasAnyCompletedRead = recordFiles.some((file) => completedReadSources.has(file));
      // A generic completed-read citation is valid only when every cited file's
      // actual body is retained. The label alone is not evidence; the body
      // makes this a deterministic read-proof reference for fallback maps.
      const hasCompletedReadReference =
        /\bcompleted\s+(?:read_file|tool)\s+result\b/i.test(evidenceText) &&
        recordFiles.length > 0 &&
        recordFiles.every((file) => evidence?.fileContents.has(file));
      const hasDirectReference =
        /`[^`\n]+`/.test(evidenceText) ||
        /\bline\s+\d+\b/i.test(evidenceText) ||
        /\b(?:function|class|const|let|var|export|return|if|for|while|async|await)\b/i.test(
          evidenceText,
        ) ||
        /\b[A-Za-z_$][\w$]*\s*\([^)]*\)/.test(evidenceText) ||
        hasCompletedReadReference;
      if (evidenceText && !hasDirectReference) {
        violations.push(
          "Evidence Map Evidence must cite a code fragment, function reference, line number, or completed tool result",
        );
      }

      const hasTruncatedRead = recordFiles.some((file) =>
        hasDisplayTruncationMarker(evidence?.fileContents.get(file) ?? ""),
      );
      const notesAreFact = /^FACT(?:\s+·\s+[A-Z_]+)*$/i.test(fields.get("notes") ?? "");
      if (notesAreFact && hasTruncatedRead) {
        violations.push(
          "Evidence Map FACT record is backed by bounded display output; a complete targeted read is required before labeling it FACT",
        );
      }
      if (
        notesAreFact &&
        evidence &&
        hasAnyCompletedRead &&
        !hasReadEvidence(recordFiles, evidence, evidenceText)
      ) {
        violations.push(
          "Evidence Map FACT record is not backed by a matching completed source read",
        );
      }
    }
  }

  if (
    /search results summary|all search queries returned|^\s*Code analysis\s*$/im.test(
      body,
    )
  ) {
    violations.push(
      "Evidence Map contains a search summary instead of file-level source evidence",
    );
  }

  const citedPaths = extractPaths(body);
  if (citedPaths.length === 0) {
    violations.push("Evidence Map does not cite a concrete inspected source file");
  }

  if (evidence && citedPaths.length > 0) {
    const readSources = new Set([
      ...evidence.toolSources.map(normalizePath),
      ...evidence.fileContents.keys(),
    ]);
    const unread = citedPaths
      .map(normalizePath)
      .filter((file) => !readSources.has(file));
    if (unread.length > 0) {
      violations.push(
        `Evidence Map cites files without completed read evidence: ${unread
          .slice(0, 3)
          .join(", ")}`,
      );
    }
  }

  if (evidence) {
    const cited = new Set(citedPaths.map(normalizePath));
    const uncoveredReads = [...evidence.fileContents.keys()]
      .map(normalizePath)
      .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/.test(file))
      .filter((file) => !/(?:^|\/)index\.[^.]+$/.test(file))
      .filter((file) => !cited.has(file));
    if (uncoveredReads.length > 0) {
      violations.push(
        `Evidence Map omits completed implementation reads: ${uncoveredReads
          .slice(0, 3)
          .join(", ")}`,
      );
    }
  }

  return violations;
}

function findingsContractViolations(response: string): string[] {
  const body = sectionBody(
    response,
    "## 3\\) Findings",
    "## 4\\) Repair Plan",
  ).trim();
  if (
    !body ||
    /No verified finding(?:s)? identified/i.test(body) ||
    /No findings? identified/i.test(body)
  ) {
    const executiveVerdict = sectionBody(
      response,
      "## 1\\) Executive Verdict",
      "## 2\\) Evidence Map",
    );
    const finalJudgment = sectionBody(
      response,
      "## 6\\) Final Judgment",
      "",
    );
    const finalJudgmentText =
      response.match(/^\s*##\s*6\)\s*Final Judgment\s*$([\s\S]*)/im)?.[1]?.trim() ??
      finalJudgment.trim();
    // Arabic model responses commonly include diacritics in decisive words
    // (`مُثبت`, `مُؤكد`). Strip only Arabic marks/tatweel for contract
    // classification; the original response remains unchanged for display.
    const normalizedExecutiveVerdict = executiveVerdict
      .normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "");
    const normalizedFinalJudgmentText = finalJudgmentText
      .normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "");
    const explicitNoFinding =
      /\bno\s+(?:verified\s+)?(?:finding|defect|bug|issue)s?\b/i.test(executiveVerdict) ||
      /(?:لا|لم)\s+(?:يوجد|توجد|يتم\s+إثبات|يثبت)\s+(?:أي\s+)?(?:Finding|عيب|خلل|مشكلة)/i.test(
        normalizedExecutiveVerdict,
      );
    const positiveDefectClaim =
      (!explicitNoFinding && (
        /\b(?:verified|confirmed|proven)\s+(?:behavioral\s+)?(?:defect|finding|bug|issue)\b/i.test(
          executiveVerdict,
        ) ||
        /\b(?:a|the)\s+(?:behavioral\s+)?(?:defect|bug|issue)\s+exists\b/i.test(
          executiveVerdict,
        ) ||
        /\bconfirmed\s+(?:code[-\s]execution|security)\s+defect\b/i.test(
          executiveVerdict,
        ) ||
        /(?:تم\s+)?(?:اكتشاف|إثبات|تأكيد|العثور\s+على)\s+(?:وجود\s+)?(?:عيب|خلل|مشكلة)\s+(?:سلوكي\s+)?(?:مثبت|مؤكد|واضح)/i.test(
          normalizedExecutiveVerdict,
        ) ||
        /(?:عيب|خلل|مشكلة)\s+(?:سلوكي\s+)?(?:مثبت|مؤكد)(?:\s|$)/i.test(
          normalizedExecutiveVerdict,
        )
      )) ||
      (/(?:Patch\s+صغير|Refactor|إعادة\s+تصميم)(?:\s|—|-|$)/i.test(
        normalizedFinalJudgmentText,
      ) &&
        !/\b(?:NOT PROVEN|INFERENCE)\b/i.test(normalizedFinalJudgmentText));

    return positiveDefectClaim
      ? [
          "Findings contradicts a positive defect claim elsewhere in the report; emit a fully evidenced Finding or mark the other sections NOT PROVEN",
        ]
      : [];
  }

  const blocks = findingBlocks(response);
  if (blocks.length === 0) {
    return ["Findings contains an unstructured claim without a recognized finding ID"];
  }

  const violations: string[] = [];
  for (const { block } of blocks) {
    for (const required of ["File(s):", "Evidence:", "Why it matters:", "Root cause:", "Fix:"]) {
      const escaped = required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`^\\s*\\*?\\s*${escaped}`, "im").test(block)) {
        violations.push(`Finding is missing required field: ${required.slice(0, -1)}`);
      }
    }
  }
  return violations;
}

function repairPlanContractViolations(response: string): string[] {
  const body = sectionBody(
    response,
    "## 4\\) Repair Plan",
    "## 5\\) Validation Checklist",
  ).trim();
  const candidateFindingIds = new Set(
    findingBlocks(response)
      .filter(({ block }) => !/^\s*ID:\s*F-\d+\s*·\s*NOT PROVEN\b/im.test(block))
      .map(({ id }) => id.toUpperCase()),
  );
  const fixtureLocalFinding =
    candidateFindingIds.size > 0 &&
    /\bFIXTURE[-\s]LOCAL\b/i.test(response) &&
    /(?:No executable repair phase|No repair phases are authorized|Do not modify this fixture|لا توجد مراحل إصلاح|لا توجد خطة إصلاح)/i.test(
      response,
    );
  if (fixtureLocalFinding) return [];

  const validationBody = sectionBody(
    response,
    "## 5\\) Validation Checklist",
    "## 6\\) Final Judgment",
  ).trim();
  const violations: string[] = [];
  const lines = body.split("\n");
  const phaseIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*(?:[-*]\s*)?Phase\b/i.test(line))
    .map(({ index }) => index);
  if (candidateFindingIds.size === 0 && phaseIndexes.length === 0) return [];
  const phaseFindingIds = new Set<string>();

  for (let phaseIndex = 0; phaseIndex < phaseIndexes.length; phaseIndex += 1) {
    const start = phaseIndexes[phaseIndex]!;
    const end = phaseIndexes[phaseIndex + 1] ?? lines.length;
    const line = lines[start]!;
    const phaseBlock = lines.slice(start, end).join("\n");
    const phaseMatch = line.match(
      /^\s*(?:[-*]\s*)?Phase\s+\d+\s+\((F-\d+)\):/i,
    );
    if (!phaseMatch) {
      violations.push("Repair Plan phase must use `Phase N (F-XX):` and link to a Finding");
      continue;
    }
    const findingId = phaseMatch[1]!.toUpperCase();
    phaseFindingIds.add(findingId);
    if (!candidateFindingIds.has(findingId)) {
      violations.push(`Repair Plan phase references unknown finding ${phaseMatch[1]}`);
    }
    if (!SOURCE_CHANGE_ACTION.test(line)) {
      violations.push(`Repair Plan phase ${findingId} contains no actionable source change`);
    }
    const fileText =
      phaseBlock.match(/(?:^|\n)[^\n]*?\bFile\(s\):\s*(.+)$/im)?.[1] ?? "";
    const phaseFiles = extractPaths(fileText).map(normalizePath);
    if (phaseFiles.length === 0) {
      violations.push(`Repair Plan phase ${findingId} must name concrete project-relative files`);
    } else if (
      phaseFiles.some((file) => file.startsWith("/") || file === ".." || file.startsWith("../"))
    ) {
      violations.push(`Repair Plan phase ${findingId} must use project-relative files`);
    }
    if (
      !/Validation profile:\s*(?:ai-orchestrator-tests|knowledge-engine-tests|api-ai-tests)\b/i.test(
        phaseBlock,
      )
    ) {
      violations.push(`Repair Plan phase ${findingId} must name a registered validation profile`);
    }
  }

  for (const findingId of candidateFindingIds) {
    if (!phaseFindingIds.has(findingId)) {
      violations.push(`Finding ${findingId} has no linked Repair Plan phase`);
    }
  }

  if (
    !validationBody ||
    /^(?:No validation|BLOCKED|FAIL\b|No behavioral)/i.test(validationBody)
  ) {
    violations.push("Every accepted Finding requires a behavior-specific validation checklist");
  } else if (!BEHAVIORAL_VALIDATION_SIGNAL.test(validationBody)) {
    violations.push(
      "Validation Checklist must name a behavior, regression, assertion, endpoint, query, or failure scenario",
    );
  } else {
    const checklistItems = validationBody
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);
    if (
      checklistItems.length > 0 &&
      checklistItems.every((item) =>
        /^(?:run|execute|perform|check|verify|validate|test)\s+(?:the\s+)?(?:focused|relevant|appropriate|requested)?\s*(?:test|tests|validation|scenario|suite)\.?$/i.test(
          item,
        ),
      )
    ) {
      violations.push(
        "Validation Checklist is generic; it must describe the behavior or regression that the repair must verify",
      );
    }
  }

  return violations;
}

function fallbackEvidenceMap(
  evidence?: ForensicEvidence,
  options: { findingAccepted?: boolean; findingEvidence?: string[] } = {},
): string[] {
  if (!evidence || evidence.fileContents.size === 0) {
    return ["No verified evidence map was produced because no completed source-file read was available."];
  }

  const classifyEvidenceFile = (file: string): "implementation" | "context" | "generated" => {
    if (/(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(file)) {
      return "generated";
    }
    if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s)$/.test(file)) {
      return "context";
    }
    return "implementation";
  };
  const inventory = [...evidence.fileContents.keys()].reduce(
    (counts, file) => {
      counts[classifyEvidenceFile(file)] += 1;
      return counts;
    },
    { implementation: 0, context: 0, generated: 0 },
  );
  const inventoryLine = [
    `Evidence inventory: ${inventory.implementation} implementation file(s)`,
    `${inventory.context} context/config file(s)`,
    `${inventory.generated} generated artifact(s).`,
  ].join(" · ");

  return [
    inventoryLine,
    "",
    ...[...evidence.fileContents.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, content]) => {
      const lines = content.split("\n");
      const firstCode = lines
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .find(({ line }) => {
          if (!line) return false;
          if (hasDisplayTruncationMarker(line)) return false;
          if (/^(?:File:\s*|```|\/\*+|\*\/|\*|\/\/|#|<!--|--->)/.test(line)) return false;
          return true;
        });
      // Imports and type-only declarations prove that a file was opened, but
      // they are weak forensic evidence because they say little about runtime
      // behavior. Prefer an executable declaration or control-flow line for
      // the bounded fallback reference. If none exists, retain the first
      // source line but label it explicitly as read proof only.
      const behavioralCode = lines
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .find(({ line }) => {
          if (!line) return false;
          if (hasDisplayTruncationMarker(line)) return false;
          if (/^(?:File:\s*|```|\/\*+|\*\/|\*|\/\/|#|<!--|--->)/.test(line)) return false;
          if (/^(?:import|export\s+type|type|interface)\b/.test(line)) return false;
          return /\b(?:function|class|const|let|var|return|if|for|while|try|catch|throw|await|new)\b|=>|[=!<>]=?/.test(
            line,
          );
        });
      const acceptedEvidence = (options.findingEvidence ?? [])
        .map((value) => value.replace(/^`|`$/g, "").trim())
        .find((value) => value.length > 0 && content.includes(value));
      const acceptedEvidenceLine = acceptedEvidence
        ? lines.map((line) => line.trim()).find((line) => line.includes(acceptedEvidence))
        : undefined;
      const reference = hasDisplayTruncationMarker(content)
        ? `completed read_file result; display truncation marker detected; targeted complete read required (read proof only; no behavioral finding accepted)`
        : options.findingAccepted && acceptedEvidence
        ? `completed read_file result; exact Finding evidence: \`${(acceptedEvidenceLine ?? acceptedEvidence).slice(0, 180)}\` (exact source evidence used by the accepted Finding)`
        : behavioralCode
        ? `completed read_file result; executable source fragment at line ${behavioralCode.lineNumber}: \`${behavioralCode.line.slice(0, 180)}\` ${
            options.findingAccepted
              ? "(exact source evidence used by the accepted Finding)"
              : "(read proof only; no behavioral finding accepted)"
          }`
        : firstCode
          ? `completed read_file result; source fragment at line ${firstCode.lineNumber}: \`${firstCode.line.slice(0, 180)}\` ${
              options.findingAccepted
                ? "(source evidence retained for the accepted Finding)"
                : "(read proof only; no behavioral finding accepted)"
            }`
        : "completed read_file result; no verifiable source fragment was available";
      const category = classifyEvidenceFile(file);
      const isConfig = category === "context";
      const isGenerated = category === "generated";
      const hasCompleteRead = !hasDisplayTruncationMarker(content);
       const note = hasCompleteRead
        ? options.findingAccepted && category === "implementation" && acceptedEvidence
          ? "FACT · EXACT_FINDING_EVIDENCE"
           : "READ_COMPLETE · NO_FINDING_ACCEPTED"
        : "NOT PROVEN · INCOMPLETE_READ";
      const role = options.findingAccepted
        ? isGenerated
          ? "generated artifact read during the forensic scan; not the Finding source"
          : isConfig
          ? "project configuration read during the forensic scan; not the Finding source"
          : "implementation source read during the forensic scan; exact evidence linked to an accepted Finding"
        : isConfig
          ? "project configuration read during the forensic scan; no behavioral inference made"
          : isGenerated
            ? "generated artifact read during the forensic scan; no behavioral inference made"
          : "implementation source read during the forensic scan; no behavioral inference made";
      const risk = options.findingAccepted
        ? "the cited source fragment was verified against the completed read and accepted by the evidence gate"
        : firstCode
          ? "the source was read, but no executable finding was accepted from the rejected report; targeted analysis is still required"
          : "the file read did not expose a verifiable source fragment";
      return [
        `File: \`${file}\`  `,
        `Role: ${role}  `,
        `Evidence: ${reference}  `,
        `Risk: ${risk}  `,
        `Notes: ${note}  `,
      ].join("\n") + "\n";
    }),
  ];
}

/** Public deterministic Evidence Map builder for staged forensic Recovery. */
export const buildForensicEvidenceMap = fallbackEvidenceMap;

/**
 * Normalize the compact five-section format used by capability-test prompts.
 *
 * The user-facing prompt may intentionally ask for `## Verdict` and
 * `## Direct Evidence` rather than the platform's six-section report. This
 * adapter is deliberately conservative: it can only promote the compact
 * response when a completed read exists, the compact evidence contains an
 * exact quoted fragment, and that fragment is present in the retained source.
 * Otherwise it returns a no-finding report and leaves the normal fail-closed
 * contract in charge.
 */
function registeredValidationProfileForPath(file: string): string | null {
  if (/(?:^|\/)lib\/ai-orchestrator(?:\/|$)/.test(file)) {
    return "ai-orchestrator-tests";
  }
  if (/(?:^|\/)lib\/knowledge-engine(?:\/|$)/.test(file)) {
    return "knowledge-engine-tests";
  }
  if (
    /(?:^|\/)artifacts\/api-server(?:\/|$)/.test(file) &&
    /(?:^|\/)(?:routes|ai)(?:\/|$)/i.test(file)
  ) {
    return "api-ai-tests";
  }
  return null;
}

export function normalizeCompactForensicReport(
  response: string,
  evidence?: ForensicEvidence,
): string | null {
  const matches = COMPACT_FORENSIC_HEADERS.map((header) =>
    new RegExp(`^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").exec(response),
  );
  if (matches.some((match) => !match || match.index === undefined)) return null;

  const starts = matches.map((match) => match!.index!);
  if (starts.some((start, index) => index > 0 && start <= starts[index - 1]!)) return null;

  const bodies = matches.map((match, index) => {
    const start = match!.index! + match![0].length;
    const end = index < matches.length - 1 ? starts[index + 1]! : response.length;
    return response.slice(start, end).trim();
  });
  const [verdictBody, directEvidence, findingBody, repairBody, validationBody] = bodies;
  if (!verdictBody || !directEvidence || !findingBody) return null;

  const noFinding = /no\s+(?:verified\s+)?finding|no\s+defect|not\s+proven/i.test(
    findingBody,
  );
  const sourceEntries = evidence
    ? [...evidence.fileContents.entries()].sort(([left], [right]) => left.localeCompare(right))
    : [];
  const quotedFragments = [...directEvidence.matchAll(/[`'"]([^`'"\n]+)[`'"]/g)]
    .map((match) => match[1]?.trim())
    .filter((fragment): fragment is string => Boolean(fragment));
  const sourceEntry = sourceEntries.find(([, content]) =>
    quotedFragments.some((fragment) => content.includes(fragment)),
  );
  const compactFiles = extractPaths(`${directEvidence}\n${findingBody}`);
  const file = sourceEntry?.[0] ??
    compactFiles.map(normalizePath).find((candidate) =>
      sourceEntries.some(([sourcePath]) => normalizePath(sourcePath) === candidate),
    );
  const exactEvidence = quotedFragments.find((fragment) =>
    sourceEntries.some(([, content]) => content.includes(fragment)),
  );
  const findingAccepted = !noFinding && Boolean(file && exactEvidence);
  const emptyClassification =
    evidence && evidence.fileContents.size > 0
      ? "NO_VERIFIED_FINDING"
      : "ANALYSIS_INCOMPLETE";

  const firstMeaningfulLine = (value: string): string =>
    value
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .find((line) => line.length > 0) ?? "Verified source defect";
  const labeled = (value: string, labels: string[]): string => {
    const labelPattern = labels.join("|");
    const match = value.match(
      new RegExp(`^\\s*(?:${labelPattern})\\s*:\\s*(.+)$`, "im"),
    );
    return match?.[1]?.trim() || firstMeaningfulLine(value);
  };
  const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();
  const evidenceMap = fallbackEvidenceMap(evidence, {
    findingAccepted,
    findingEvidence: exactEvidence ? [exactEvidence] : [],
  }).join("\n");
  const findingText = findingAccepted
    ? [
        "ID: F-01 · " + oneLine(firstMeaningfulLine(findingBody)),
        `* File(s): \`${file}\``,
        `* Evidence: \`${exactEvidence}\``,
        `* Why it matters: ${oneLine(labeled(findingBody, ["Why it matters", "Impact"]))}`,
        `* Root cause: ${oneLine(labeled(findingBody, ["Root cause", "Cause"]))}`,
        `* Fix: ${oneLine(labeled(repairBody, ["Fix", "Recommendation", "Remediation"]))}`,
      ].join("\n")
    : "No verified finding identified from inspected source code.";
  const registeredProfile = file ? registeredValidationProfileForPath(file) : null;
  const repairText = findingAccepted && repairBody &&
      !/no\s+repair|no\s+phase/i.test(repairBody) &&
      registeredProfile
    ? `Phase 1 (F-01): ${oneLine(repairBody)} — File(s): \`${file}\` — Validation profile: ${registeredProfile} — PROPOSED: files are not applied and behavioral validation is pending.`
    : "No repair phases identified because no executable Finding was accepted.";
  const validationText = findingAccepted && validationBody &&
      !/no\s+validation|not\s+available/i.test(validationBody)
    ? `- ${oneLine(validationBody)}`
    : "BLOCKED — no behavioral validation scenario is applicable because no Finding was accepted.";

  return [
    "## 1) Executive Verdict",
    findingAccepted ? oneLine(verdictBody) : `${emptyClassification} — ${oneLine(verdictBody)}`,
    "",
    "## 2) Evidence Map",
    evidenceMap || "No verified evidence map was produced because no completed source-file read was available.",
    "",
    "## 3) Findings",
    findingText,
    "",
    "## 4) Repair Plan",
    repairText,
    "",
    "## 5) Validation Checklist",
    validationText,
    "",
    "## 6) Final Judgment",
    findingAccepted
      ? oneLine(verdictBody)
      : `${emptyClassification} — the compact response did not provide a directly verifiable Finding. This does not prove the implementation is correct; no Repair Plan is executable.`,
  ].join("\n");
}

/**
 * Repair only harmless Markdown heading variants before applying the forensic
 * contract. Providers commonly omit `##` or use `1.` instead of `1)` even
 * when all six sections and their order are present. This adapter changes no
 * claim, evidence, path, or plan content; those still pass the normal gates.
 */
export function normalizeForensicSectionHeadings(response: string): string | null {
  const titles = [
    "Executive Verdict",
    "Evidence Map",
    "Findings",
    "Repair Plan",
    "Validation Checklist",
    "Final Judgment",
  ] as const;
  // Never rewrite an already canonical report. Besides avoiding needless
  // churn, this preserves duplicate-heading diagnostics for the normal
  // contract gate to report precisely.
  if (FORENSIC_SECTION_HEADERS.every((header) => headerCount(response, header) === 1)) {
    return response;
  }
  const headingPattern = /^\s*(?:#{1,6}\s*)?(\d+)\s*[.)]\s+(.+?)\s*$/gim;
  const matches = [...response.matchAll(headingPattern)].filter((match) =>
    titles.some((title) => match[1] === String(titles.indexOf(title) + 1) &&
      match[2]?.trim().toLocaleLowerCase() === title.toLocaleLowerCase()),
  );
  if (matches.length !== titles.length) return null;
  const ordered = matches.every((match, index) =>
    match[1] === String(index + 1) &&
    match[2]?.trim().toLocaleLowerCase() === titles[index]!.toLocaleLowerCase(),
  );
  if (!ordered) return null;

  let normalized = response;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!;
    const start = match.index ?? -1;
    if (start < 0) return null;
    const lineEnd = normalized.indexOf("\n", start);
    const end = lineEnd < 0 ? normalized.length : lineEnd;
    normalized =
      normalized.slice(0, start) +
      `## ${index + 1}) ${titles[index]}` +
      normalized.slice(end);
  }
  return normalized;
}

function replaceSection(
  response: string,
  header: string,
  nextHeader: string,
  body: string,
): string {
  const headerPattern = new RegExp(
    `^[\\t ]*${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\t ]*$`,
    "im",
  );
  const start = response.search(headerPattern);
  if (start < 0) return response;
  const newline = response.indexOf("\n", start);
  if (newline < 0) return response;
  const bodyStart = newline + 1;
  const remainder = response.slice(bodyStart);
  const end = nextHeader
    ? remainder.search(
        new RegExp(
          `^[\\t ]*${nextHeader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\t ]*$`,
          "im",
        ),
      )
    : remainder.length;
  if (end < 0) return response;
  return (
    response.slice(0, bodyStart) +
    `${body.trimEnd()}\n\n` +
    remainder.slice(end)
  );
}

function stripRecoveryMetadata(response: string): string {
  const marker = response.search(
    /^\s*(?:Original response violations:|Current fallback status:)\s*$/im,
  );
  return marker >= 0 ? response.slice(0, marker).trimEnd() : response;
}

function contractViolations(
  response: string,
  evidence?: ForensicEvidence,
): string[] {
  const violations: string[] = [];
  for (const header of FORENSIC_SECTION_HEADERS) {
    const count = headerCount(response, header);
    if (count === 0) violations.push(`missing required section: ${header}`);
    if (count > 1) violations.push(`duplicate required section: ${header}`);
  }
  violations.push(...sectionOrderViolations(response));

  for (const { pattern, reason } of PLACEHOLDER_REPORT_PATTERNS) {
    if (pattern.test(response)) violations.push(reason);
  }
  const unresolvedScopeChoice =
    /Patch\s+صغير\s*\/\s*Refactor\s*\/\s*إعادة\s+تصميم\s*(?:—|-)/i.test(response) &&
    !/Patch\s+صغير\s*\/\s*Refactor\s*\/\s*إعادة\s+تصميم\s*(?:—|-)\s*NOT\s+PROVEN\b/i.test(response);
  if (unresolvedScopeChoice) {
    violations.push("Final Judgment contains an unresolved repair-scope choice");
  }
  violations.push(...executiveVerdictContractViolations(response));
  violations.push(...broadReportClaimViolations(response));
  violations.push(...findingsContractViolations(response));
  violations.push(...repairPlanContractViolations(response));
  if (/\b\d{1,3}\s*\/\s*100\b/.test(response)) {
    violations.push(
      "The report contains an unverified numeric score; cite a completed metric result or omit the number",
    );
  }
  violations.push(...evidenceMapContractViolations(response, evidence));
  return violations;
}

function repairContractFromEvidence(
  response: string,
  evidence: ForensicEvidence | undefined,
  violations: string[],
): string | null {
  const repairable = violations.every((reason) =>
    reason.startsWith("Evidence Map") ||
    reason.includes("unverified broad quality or completeness claim") ||
    reason.includes("Executive Verdict contains an unverified broad quality or completeness claim") ||
    reason.includes("Findings contains an unstructured claim") ||
    reason.startsWith("Finding is missing required field:") ||
    reason.startsWith("Repair Plan phase") ||
    reason.includes("unverified numeric score") ||
    reason.includes("unresolved repair-scope choice") ||
    reason.includes("Every accepted Finding requires a behavior-specific validation checklist") ||
    reason.includes("Validation Checklist is generic"),
  );
  if (!repairable) return null;
  if (!evidence || evidence.fileContents.size === 0) return null;

  let repaired = response;
  const findingsNeedRemoval = violations.some(
    (reason) =>
      reason.includes("Findings contains an unstructured claim") ||
      reason.startsWith("Finding is missing required field:"),
  );
  const planNeedsRemoval =
    findingsNeedRemoval || violations.some((reason) => reason.startsWith("Repair Plan phase"));
  const evidenceMapNeedsRepair = violations.some((reason) =>
    reason.startsWith("Evidence Map"),
  );

  if (
    violations.some((reason) =>
      reason.includes("unverified broad quality or completeness claim"),
    ) &&
    evidenceMapNeedsRepair
  ) {
    repaired = neutralizeBroadReportClaims(repaired);
  }

  if (
    violations.some((reason) => reason.startsWith("Evidence Map")) &&
    headerCount(repaired, FORENSIC_SECTION_HEADERS[1]) === 1
  ) {
    repaired = replaceSection(
      repaired,
      FORENSIC_SECTION_HEADERS[1],
      FORENSIC_SECTION_HEADERS[2],
      fallbackEvidenceMap(evidence).join("\n"),
    );
  }

  if (
    violations.some((reason) =>
      reason.includes("unverified broad quality or completeness claim"),
    ) &&
    headerCount(repaired, FORENSIC_SECTION_HEADERS[0]) === 1
  ) {
    repaired = replaceSection(
      repaired,
      FORENSIC_SECTION_HEADERS[0],
      FORENSIC_SECTION_HEADERS[1],
      "NOT PROVEN — the available source evidence does not establish a broad quality or completeness claim.",
    );
  }

  if (findingsNeedRemoval && headerCount(repaired, FORENSIC_SECTION_HEADERS[2]) === 1) {
    repaired = replaceSection(
      repaired,
      FORENSIC_SECTION_HEADERS[2],
      FORENSIC_SECTION_HEADERS[3],
      "No verified finding identified from inspected source code.",
    );
    if (headerCount(repaired, FORENSIC_SECTION_HEADERS[4]) === 1) {
      repaired = replaceSection(
        repaired,
        FORENSIC_SECTION_HEADERS[4],
        FORENSIC_SECTION_HEADERS[5],
        "BLOCKED — no behavioral validation scenario is applicable because no Finding was accepted.",
      );
    }
  }

  if (planNeedsRemoval && headerCount(repaired, FORENSIC_SECTION_HEADERS[3]) === 1) {
    repaired = replaceSection(
      repaired,
      FORENSIC_SECTION_HEADERS[3],
      FORENSIC_SECTION_HEADERS[4],
      "No repair phases identified because no executable Finding was accepted.",
    );
  }

  if (
    (violations.some((reason) =>
      reason.includes("unverified numeric score") ||
      reason.includes("unresolved repair-scope choice"),
    )) &&
    headerCount(repaired, FORENSIC_SECTION_HEADERS[5]) === 1
  ) {
    repaired = replaceSection(
      repaired,
      FORENSIC_SECTION_HEADERS[5],
      "",
      "NOT PROVEN — the available evidence does not establish a repair scope or numeric quality score.",
    );
  }

  return contractViolations(repaired, evidence).length === 0 ? repaired : null;
}

function safeForensicContractFallback(evidence?: ForensicEvidence): string {
  const hasCompletedEvidence = (evidence?.fileContents.size ?? 0) > 0;
  const classification = hasCompletedEvidence
    ? "NO_VERIFIED_FINDING"
    : "ANALYSIS_INCOMPLETE";
  const executiveVerdict = hasCompletedEvidence
    ? `${classification} — no verified Finding was established from the completed source reads.`
    : `${classification} — the analysis could not establish a Finding because no completed source-file read was available.`;
  const validation = hasCompletedEvidence
    ? [
        "- Graph empty: verify the audit remains safe when the knowledge graph has no nodes.",
        "- Invalid relationship: reject relationships whose endpoints are invalid or disconnected.",
        "- Missing provenance: reject evidence and edges that lack source provenance.",
        "- Nonexistent node: return a bounded no-finding result for a node that is not present.",
      ].join("\n")
    : [
        "- BLOCKED — graph-empty behavior cannot be verified without a completed source read.",
        "- BLOCKED — invalid-relationship behavior cannot be verified without a completed source read.",
        "- BLOCKED — missing-provenance behavior cannot be verified without a completed source read.",
        "- BLOCKED — nonexistent-node behavior cannot be verified without a completed source read.",
      ].join("\n");
  const finalJudgment = hasCompletedEvidence
    ? `${classification} — completed source reads were preserved, but no verified defect was established. No Repair Plan is executable.`
    : `${classification} — the report could not be verified because source evidence is incomplete. No Repair Plan is executable.`;

  return [
    "## 1) Executive Verdict",
    executiveVerdict,
    "",
    "## 2) Evidence Map",
    ...fallbackEvidenceMap(evidence),
    "",
    "## 3) Findings",
    "No verified finding identified from inspected source code.",
    "",
    "## 4) Repair Plan",
    "No repair phases identified because no executable Finding was accepted.",
    "",
    "## 5) Validation Checklist",
    validation,
    "",
    "## 6) Final Judgment",
    finalJudgment,
  ].join("\n");
}

/**
 * Enforce the report-level contract before evidence validation. A response
 * that contains only a generic Summary must never be presented as a forensic
 * audit, even when it contains no individual Finding to downgrade.
 */
export function applyForensicOutputContract(
  response: string,
  evidence?: ForensicEvidence,
): ForensicContractResult {
  const normalizedResponse =
    normalizeCompactForensicReport(response, evidence) ??
    normalizeForensicSectionHeadings(stripRecoveryMetadata(response)) ??
    stripRecoveryMetadata(response);
  const violations = contractViolations(normalizedResponse, evidence);

  if (violations.length === 0) {
    return { response: normalizedResponse, valid: true, violations: [] };
  }

  const repaired = repairContractFromEvidence(normalizedResponse, evidence, violations);
  if (repaired) {
    console.info(
      JSON.stringify({
        scope: "forensic-output-guard",
        code: "FORENSIC_CONTRACT_REPAIRED_FROM_EVIDENCE",
        originalViolationCount: violations.length,
      }),
    );
    return { response: repaired, valid: true, violations: [] };
  }

  // A provider may return a structurally valid six-section report whose
  // Evidence Map contains abbreviated or stale paths. If any complete source
  // bodies are retained, never pass that provider text through as the final
  // fallback: rebuild the whole report deterministically from those bodies.
  // This is deliberately evidence-only and therefore cannot authorize a
  // Finding or Repair Plan that the source reads do not prove.
  if (
    evidence &&
    evidence.fileContents.size > 0 &&
    violations.some((reason) => reason.startsWith("Evidence Map"))
  ) {
    const deterministicFallback = safeForensicContractFallback(evidence);
    console.info(
      JSON.stringify({
        scope: "forensic-output-guard",
        code: "FORENSIC_EVIDENCE_MAP_REBUILT_FINAL",
        originalViolationCount: violations.length,
      }),
    );
    return {
      response: deterministicFallback,
      valid: true,
      violations: [],
      evidenceMapRebuilt: true,
    };
  }

  console.warn(
    JSON.stringify({
      scope: "forensic-output-guard",
      code: "FORENSIC_CONTRACT_GATE",
      violations,
    }),
  );
  return {
    response: safeForensicContractFallback(evidence),
    valid: false,
    violations,
  };
}

/**
 * Downgrade unsupported forensic Findings and block their corresponding plan
 * phases. Normal chat responses must not call this function.
 */
export function applyForensicEvidenceGate(
  response: string,
  evidence: ForensicEvidence,
  options: { allowPartialScopeFinding?: boolean } = {},
): ForensicGateResult {
  const blocks = findingBlocks(response);
  if (blocks.length === 0) return { response, violations: [] };

  const violations: ForensicEvidenceViolation[] = [];
  const replacements = blocks.map(({ id, start, end, block }) => {
    const fileLine = block.match(FILE_LINE)?.[1] ?? "";
    const evidenceText = block.match(EVIDENCE_LINE)?.[1] ?? "";
    const filePaths = extractPaths(fileLine);
    const normalizedFiles = filePaths.map(normalizePath);
    // Semantic contradiction rules are only meaningful against source that
    // was actually read. Without source contents, the evidence gate may mark
    // the Finding NOT PROVEN for missing evidence, but must not invent a
    // semantic downgrade from report wording alone.
    const sourceContents = normalizedFiles
      .map((file) => evidence.fileContents.get(file) ?? evidence.searchResults?.get(file))
      .filter((value): value is string => Boolean(value));
    const reasons = sourceContents.length > 0 ? knownFalsePositiveReasons(block) : [];
    if (
      evidence.allowTestSources !== true &&
      normalizedFiles.some((file) => isForensicTestSourcePath(file))
    ) {
      reasons.push("the cited source is a test or fixture file excluded from production Findings");
    }

    if (filePaths.length === 0) reasons.push("no concrete source path was cited");
    if (filePaths.length > 0 && !hasReadEvidence(filePaths, evidence, evidenceText)) {
      reasons.push("the cited file/evidence was not verified by a completed read result");
    }
    if (
      evidence.sourceCoverage &&
      !evidence.sourceCoverage.complete &&
      !options.allowPartialScopeFinding
    ) {
      reasons.push(
        evidence.sourceCoverage.reason ??
          "the requested forensic source scope was not completely read",
      );
    }
    reasons.push(...sourceConflictsWithFinding(block, evidenceText, sourceContents));

    if (reasons.length === 0) return { start, end, text: block };

    violations.push({ findingId: id, reasons });
    const downgraded = block
      .replace(/^(\s*(?:[*-]\s*)?ID:\s*F-\d+\s*·\s*)[^\n]+$/im, "$1NOT PROVEN")
      .replace(
        /\n\s*\*\s*Evidence Gate:.*$/im,
        "",
      )
      .trimEnd();
    return {
      start,
      end,
      text:
        `${downgraded}\n` +
        `* Evidence Gate: NOT PROVEN — ${reasons.join("; ")}. ` +
        "Verify the source and reproduce the failure before proposing a repair.",
    };
  });

  let gated = response;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i]!;
    gated = gated.slice(0, replacement.start) + replacement.text + gated.slice(replacement.end);
  }

  if (violations.length > 0) {
    gated = gated.replace(PLAN_LINE, (line, _fullMatch: string, id: string) => {
      if (!violations.some((violation) => violation.findingId === id)) return line;
      return `${line} [BLOCKED: ${id} is NOT PROVEN; no repair should be applied from this phase]`;
    });
    gated = rewriteFinalJudgment(
      gated,
      "NOT PROVEN — one or more candidate Findings failed the evidence or semantic gate. Blocked repair phases are not executable.",
    );
    console.warn(
      JSON.stringify({
        scope: "forensic-output-guard",
        code: "FORENSIC_EVIDENCE_GATE",
        violations,
      }),
    );
  }

  return { response: gated, violations };
}

/**
 * Reconstruct the evidence available to the output gate from the same
 * assistant/tool messages that were sent to the provider. This includes
 * synthetic prefetch reads and real tool-loop reads, while excluding search
 * results that do not identify a concrete file body.
 */
export function collectForensicEvidence(
  messages: EvidenceMessage[],
  toolSources: string[],
  knownFileContents?: Map<string, string>,
  allowTestSources = true,
  scope?: ForensicEvidenceScope,
  sourceCoverage?: ForensicSourceCoverage,
  requireCompleteReadEvidence = false,
): ForensicEvidence {
  const fileContents = new Map<string, string>();
  const incompleteFiles = new Set<string>();
  for (const [path, rawContent] of knownFileContents ?? []) {
    const normalizedPath = normalizePath(path);
    if (!isAllowedEvidencePath(normalizedPath, allowTestSources, scope)) continue;
    const content = normalizeToolEvidence(rawContent);
    if (!isInvalidToolEvidence(content)) {
      fileContents.set(normalizedPath, content);
      if (hasDisplayTruncationMarker(content)) incompleteFiles.add(normalizedPath);
    }
  }
  const searchResults = new Map<string, string>();
  const toolCallPaths = new Map<string, string>();
  const searchToolCalls = new Map<string, { pattern: string; fileGlob?: string }>();

  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.id && toolCall.function?.name === "read_file") {
          try {
            const parsed = JSON.parse(String(toolCall.function.arguments ?? "{}")) as { path?: unknown };
            if (typeof parsed.path === "string" && parsed.path.trim()) {
              const normalizedPath = normalizePath(parsed.path);
              if (isAllowedEvidencePath(normalizedPath, allowTestSources, scope)) {
                toolCallPaths.set(toolCall.id, normalizedPath);
              }
            }
          } catch {
            // Malformed tool arguments are not evidence.
          }
        } else if (toolCall.id && toolCall.function?.name === "search_code") {
          try {
            const parsed = JSON.parse(String(toolCall.function.arguments ?? "{}")) as {
              pattern?: unknown;
              file_glob?: unknown;
            };
            if (typeof parsed.pattern === "string" && parsed.pattern.trim()) {
              searchToolCalls.set(toolCall.id, {
                pattern: parsed.pattern,
                fileGlob: typeof parsed.file_glob === "string" ? parsed.file_glob : undefined,
              });
            }
          } catch {
            // Malformed search arguments are not evidence.
          }
        }
      }
      continue;
    }

    if (message.role !== "tool" || !message.tool_call_id) continue;
    const sourcePath = toolCallPaths.get(message.tool_call_id);
    const rawContent = String(message.content ?? "");
    if (!rawContent || /^Error\b/i.test(rawContent.trim())) continue;
    const content = normalizeToolEvidence(rawContent);
    if (isInvalidToolEvidence(content)) continue;
    if (sourcePath) {
      fileContents.set(sourcePath, content);
      if (hasDisplayTruncationMarker(content)) incompleteFiles.add(sourcePath);
      continue;
    }

    const search = searchToolCalls.get(message.tool_call_id);
    if (!search) continue;
    // search_code returns project-relative `path:line:snippet` rows. Associate
    // each row with its concrete file so the Finding can cite the exact line.
    for (const row of content.split("\n")) {
      const match = row.match(/^(.+?):\d+:(.*)$/);
      if (!match?.[1]) continue;
      const path = normalizePath(match[1].trim());
      const previous = searchResults.get(path);
      searchResults.set(path, previous ? `${previous}\n${row}` : row);
    }
  }

  return {
    toolSources: [
      ...new Set(
        toolSources
          .map(normalizePath)
          .filter((source) => isAllowedEvidencePath(source, allowTestSources, scope)),
      ),
    ],
    fileContents,
    searchResults,
    allowTestSources,
    scope,
    incompleteFiles,
    sourceCoverage,
    requireCompleteReadEvidence,
  };
}